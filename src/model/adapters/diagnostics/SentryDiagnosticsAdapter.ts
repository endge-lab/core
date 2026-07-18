import type {
  DiagnosticsAdapter,
  DiagnosticsAdapterCreateContext,
  DiagnosticsAdapterFactory,
  DiagnosticsAdapterRecordContext,
  DiagnosticsAdapterSnapshotContext,
  DiagnosticsAttributes,
  DiagnosticsLogRecord,
  DiagnosticsRecord,
  DiagnosticsSnapshot,
  DiagnosticsSpanRecord,
  EndgeDiagnosticsOutputConfiguration,
} from '@/domain/types/diagnostics'
import type { SentryDiagnosticsAdapterOptions } from './SentryDiagnosticsAdapter.types'

const SENTRY_PROTOCOL_VERSION = '7'
const SENTRY_SDK_NAME = 'endge.diagnostics'
const SENTRY_SDK_VERSION = '1.0.0'

interface ParsedSentryDsn {
  dsn: string
  envelopeUrl: string
}

interface SentryEnvelopeAttachment {
  filename: string
  contentType: string
  body: string
}

/** Системный adapter доставки Endge telemetry и snapshots в Sentry ingestion API. */
export class SentryDiagnosticsAdapter implements DiagnosticsAdapter {
  public readonly id: string

  private readonly _name: string
  private readonly _dsn: string
  private readonly _envelopeUrl: string
  private readonly _environment?: string
  private readonly _release?: string
  private readonly _serverName?: string
  private readonly _sendSnapshots: boolean
  private readonly _requestTimeoutMs: number
  private readonly _tags: Record<string, string>
  private readonly _pending = new Set<Promise<void>>()

  /** Создаёт Sentry adapter и разрешает variable tokens только в runtime copy options. */
  public constructor(
    output: EndgeDiagnosticsOutputConfiguration,
    context: DiagnosticsAdapterCreateContext,
  ) {
    this.id = output.id
    this._name = output.name

    const options = this._normalizeOptions(output, context)
    const parsedDsn = this._parseDsn(options.dsn, options.tunnel)
    this._dsn = parsedDsn.dsn
    this._envelopeUrl = parsedDsn.envelopeUrl
    this._environment = options.environment
    this._release = options.release
    this._serverName = options.serverName
    this._sendSnapshots = options.sendSnapshots !== false
    this._requestTimeoutMs = this._normalizePositiveInteger(options.requestTimeoutMs, 10_000)
    this._tags = this._normalizeTags(options.tags)
  }

  /** Преобразует routed log в Sentry event, а завершённый span — в transaction. */
  public acceptRecord(record: DiagnosticsRecord, context: DiagnosticsAdapterRecordContext): Promise<void> {
    const payload = record.signal === 'log'
      ? this._mapLogRecord(record, context)
      : this._mapSpanRecord(record, context)
    return this._track(this._sendEnvelope(record.signal === 'log' ? 'event' : 'transaction', payload))
  }

  /** Отправляет snapshot как отдельное событие с полным JSON attachment. */
  public acceptSnapshot(snapshot: DiagnosticsSnapshot, context: DiagnosticsAdapterSnapshotContext): Promise<void> | void {
    if (!this._sendSnapshots)
      return

    const snapshotBody = JSON.stringify(snapshot)
    const payload = this._baseEvent(context.resource.attributes, {
      message: `Endge diagnostics snapshot (${snapshot.trigger})`,
      timestamp: snapshot.generatedAt / 1_000,
      level: snapshot.trigger === 'automatic' ? 'warning' : 'info',
      tags: {
        'endge.signal': 'snapshot',
        'endge.snapshot.trigger': snapshot.trigger,
        'endge.output.id': this.id,
      },
      extra: {
        outputName: this._name,
        sessionId: snapshot.telemetry?.sessionId ?? context.sessionId,
        counters: snapshot.telemetry?.counters,
      },
    })
    return this._track(this._sendEnvelope('event', payload, {
      filename: `endge-diagnostics-${snapshot.generatedAt}.json`,
      contentType: 'application/json',
      body: snapshotBody,
    }))
  }

  /** Отправляет безопасное тестовое событие, не добавляя запись в локальную diagnostics history. */
  public test(): Promise<void> {
    const payload = this._baseEvent({}, {
      message: `Endge diagnostics output test: ${this._name}`,
      timestamp: Date.now() / 1_000,
      level: 'info',
      tags: {
        'endge.signal': 'test',
        'endge.output.id': this.id,
      },
    })
    return this._track(this._sendEnvelope('event', payload))
  }

  /** Ожидает завершения всех ingestion requests, начатых adapter-ом. */
  public async flush(): Promise<void> {
    const pending = [...this._pending]
    if (pending.length)
      await Promise.all(pending)
  }

  /** Завершает pending delivery перед освобождением adapter. */
  public dispose(): Promise<void> {
    return this.flush()
  }

  /** Нормализует persisted options и разрешает только строковые runtime credentials. */
  private _normalizeOptions(
    output: EndgeDiagnosticsOutputConfiguration,
    context: DiagnosticsAdapterCreateContext,
  ): SentryDiagnosticsAdapterOptions {
    const options = output.options
    const resolve = (value: unknown): string | undefined => {
      if (typeof value !== 'string')
        return undefined
      const resolved = context.resolveVariable ? context.resolveVariable(value) : value
      const text = String(resolved ?? '').trim()
      return text || undefined
    }
    const dsn = resolve(options.dsn)
    if (!dsn)
      throw new Error(`[SentryDiagnosticsAdapter] Output "${output.id}" requires a resolved DSN`)

    return {
      dsn,
      ...(resolve(options.environment) ? { environment: resolve(options.environment) } : {}),
      ...(resolve(options.release) ? { release: resolve(options.release) } : {}),
      ...(resolve(options.serverName) ? { serverName: resolve(options.serverName) } : {}),
      ...(resolve(options.tunnel) ? { tunnel: resolve(options.tunnel) } : {}),
      sendSnapshots: options.sendSnapshots !== false,
      requestTimeoutMs: Number(options.requestTimeoutMs),
      tags: this._readTags(options.tags),
    }
  }

  /** Разбирает standard Sentry DSN и строит browser-safe envelope endpoint. */
  private _parseDsn(dsn: string, tunnel?: string): ParsedSentryDsn {
    let url: URL
    try {
      url = new URL(dsn)
    }
    catch {
      throw new Error('[SentryDiagnosticsAdapter] Invalid Sentry DSN')
    }

    const publicKey = decodeURIComponent(url.username)
    const pathSegments = url.pathname.split('/').filter(Boolean)
    const projectId = pathSegments.pop()
    if (!publicKey || !projectId || (url.protocol !== 'http:' && url.protocol !== 'https:'))
      throw new Error('[SentryDiagnosticsAdapter] Sentry DSN must contain protocol, public key and project id')

    const prefix = pathSegments.length ? `/${pathSegments.join('/')}` : ''
    const auth = new URLSearchParams({
      sentry_key: publicKey,
      sentry_version: SENTRY_PROTOCOL_VERSION,
      sentry_client: `${SENTRY_SDK_NAME}/${SENTRY_SDK_VERSION}`,
    })
    return {
      dsn,
      envelopeUrl: tunnel || `${url.origin}${prefix}/api/${encodeURIComponent(projectId)}/envelope/?${auth}`,
    }
  }

  /** Преобразует Endge log record в Sentry event payload. */
  private _mapLogRecord(record: DiagnosticsLogRecord, context: DiagnosticsAdapterRecordContext): Record<string, unknown> {
    const attributes = record.attributes
    const exceptionType = this._attributeText(attributes, 'exception.type')
    const exceptionMessage = this._attributeText(attributes, 'exception.message')
    const exceptionStacktrace = this._attributeText(attributes, 'exception.stacktrace')
    return this._baseEvent(context.resource.attributes, {
      message: record.body,
      timestamp: record.timestamp / 1_000,
      level: this._mapLogLevel(record),
      logger: record.scope.name,
      ...(record.eventName ? { transaction: record.eventName } : {}),
      tags: {
        'endge.signal': 'log',
        'endge.output.id': this.id,
        ...(record.phase ? { 'endge.phase': record.phase } : {}),
        ...(record.eventName ? { 'endge.event.name': record.eventName } : {}),
      },
      contexts: this._traceContext(record),
      extra: {
        attributes,
        routeIds: context.routeIds,
        sessionId: context.sessionId,
        ...(exceptionStacktrace ? { exceptionStacktrace } : {}),
      },
      ...(exceptionType || exceptionMessage
        ? {
            exception: {
              values: [{
                type: exceptionType || 'Error',
                value: exceptionMessage || record.body,
                mechanism: { type: 'endge.diagnostics', handled: true },
              }],
            },
          }
        : {}),
      ...(this._mapUser(attributes) ? { user: this._mapUser(attributes) } : {}),
    })
  }

  /** Преобразует завершённый Endge span в Sentry transaction payload. */
  private _mapSpanRecord(record: DiagnosticsSpanRecord, context: DiagnosticsAdapterRecordContext): Record<string, unknown> {
    return this._baseEvent(context.resource.attributes, {
      type: 'transaction',
      transaction: record.name,
      transaction_info: { source: 'custom' },
      start_timestamp: record.startTimestamp / 1_000,
      timestamp: record.endTimestamp / 1_000,
      contexts: this._traceContext(record),
      spans: [],
      tags: {
        'endge.signal': 'span',
        'endge.output.id': this.id,
        ...(record.phase ? { 'endge.phase': record.phase } : {}),
      },
      extra: {
        attributes: record.attributes,
        durationMs: record.durationMs,
        routeIds: context.routeIds,
        sessionId: context.sessionId,
        statusMessage: record.status.message,
      },
      ...(this._mapUser(record.attributes) ? { user: this._mapUser(record.attributes) } : {}),
    })
  }

  /** Добавляет общие Sentry environment, release, resource и static tags. */
  private _baseEvent(
    resource: DiagnosticsAttributes,
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    const payloadTags = this._normalizeTags(payload.tags)
    return {
      platform: 'javascript',
      sdk: { name: SENTRY_SDK_NAME, version: SENTRY_SDK_VERSION },
      ...(this._environment ? { environment: this._environment } : {}),
      ...(this._release ? { release: this._release } : {}),
      ...(this._serverName ? { server_name: this._serverName } : {}),
      ...payload,
      tags: {
        ...this._tags,
        ...this._resourceTags(resource),
        ...payloadTags,
      },
      extra: {
        resource,
        ...(this._isRecord(payload.extra) ? payload.extra : {}),
      },
    }
  }

  /** Формирует Sentry trace context из OpenTelemetry-compatible ids. */
  private _traceContext(record: DiagnosticsRecord): Record<string, unknown> {
    if (!record.traceId || !record.spanId)
      return {}
    return {
      trace: {
        trace_id: record.traceId,
        span_id: record.spanId,
        ...(record.signal === 'span' && record.parentSpanId ? { parent_span_id: record.parentSpanId } : {}),
        op: record.signal === 'span' ? record.scope.name : 'endge.log',
        status: record.signal === 'span'
          ? this._mapSpanStatus(record)
          : record.severityNumber >= 17 ? 'internal_error' : 'ok',
      },
    }
  }

  /** Выделяет Sentry user context из стандартных diagnostics attributes. */
  private _mapUser(attributes: DiagnosticsAttributes): Record<string, string> | undefined {
    const id = this._attributeText(attributes, 'user.id')
    const email = this._attributeText(attributes, 'user.email')
    const username = this._attributeText(attributes, 'user.username')
    const sessionId = this._attributeText(attributes, 'session.id')
    if (!id && !email && !username && !sessionId)
      return undefined
    return {
      ...(id ? { id } : {}),
      ...(email ? { email } : {}),
      ...(username ? { username } : {}),
      ...(sessionId ? { segment: sessionId } : {}),
    }
  }

  /** Собирает envelope и выполняет один ingestion request. */
  private async _sendEnvelope(
    itemType: 'event' | 'transaction',
    payload: Record<string, unknown>,
    attachment?: SentryEnvelopeAttachment,
  ): Promise<void> {
    if (typeof globalThis.fetch !== 'function')
      throw new Error('[SentryDiagnosticsAdapter] Runtime does not provide fetch')

    const eventId = this._createEventId()
    const envelopeLines = [
      JSON.stringify({
        event_id: eventId,
        sent_at: new Date().toISOString(),
        dsn: this._dsn,
        sdk: { name: SENTRY_SDK_NAME, version: SENTRY_SDK_VERSION },
      }),
      JSON.stringify({ type: itemType, content_type: 'application/json' }),
      JSON.stringify({ event_id: eventId, ...payload }),
    ]
    if (attachment) {
      envelopeLines.push(
        JSON.stringify({
          type: 'attachment',
          length: new TextEncoder().encode(attachment.body).byteLength,
          filename: attachment.filename,
          content_type: attachment.contentType,
          attachment_type: 'event.attachment',
        }),
        attachment.body,
      )
    }

    const controller = new AbortController()
    const timeoutId = globalThis.setTimeout(() => controller.abort(), this._requestTimeoutMs)
    try {
      const response = await globalThis.fetch(this._envelopeUrl, {
        method: 'POST',
        body: envelopeLines.join('\n'),
        signal: controller.signal,
      })
      if (!response.ok)
        throw new Error(`[SentryDiagnosticsAdapter] Ingestion failed with HTTP ${response.status}`)
    }
    finally {
      globalThis.clearTimeout(timeoutId)
    }
  }

  /** Учитывает pending request для flush и удаляет его после завершения. */
  private _track(request: Promise<void>): Promise<void> {
    this._pending.add(request)
    void request.then(
      () => this._pending.delete(request),
      () => this._pending.delete(request),
    )
    return request
  }

  /** Преобразует Endge severity в Sentry event level. */
  private _mapLogLevel(record: DiagnosticsLogRecord): 'debug' | 'info' | 'warning' | 'error' | 'fatal' {
    if (record.severityNumber >= 21) return 'fatal'
    if (record.severityNumber >= 17) return 'error'
    if (record.severityNumber >= 13) return 'warning'
    if (record.severityNumber >= 9) return 'info'
    return 'debug'
  }

  /** Преобразует Endge span status в Sentry trace status. */
  private _mapSpanStatus(record: DiagnosticsSpanRecord): 'ok' | 'internal_error' | 'unknown' {
    if (record.status.code === 'ok') return 'ok'
    if (record.status.code === 'error') return 'internal_error'
    return 'unknown'
  }

  /** Проецирует resource attributes в ограниченный набор Sentry tags. */
  private _resourceTags(resource: DiagnosticsAttributes): Record<string, string> {
    const tags: Record<string, string> = {}
    for (const key of [
      'service.name',
      'service.version',
      'deployment.environment.name',
      'endge.workspace.id',
      'endge.tenant.id',
      'endge.project.id',
    ]) {
      const value = this._attributeText(resource, key)
      if (value)
        tags[key] = value
    }
    return tags
  }

  /** Читает adapter tags из JSON-safe options. */
  private _readTags(value: unknown): SentryDiagnosticsAdapterOptions['tags'] {
    if (!this._isRecord(value))
      return undefined
    const tags: NonNullable<SentryDiagnosticsAdapterOptions['tags']> = {}
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
        tags[key] = item
    }
    return tags
  }

  /** Нормализует произвольный tags object в строковые Sentry tags. */
  private _normalizeTags(value: unknown): Record<string, string> {
    if (!this._isRecord(value))
      return {}
    const tags: Record<string, string> = {}
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
        tags[key] = String(item).slice(0, 200)
    }
    return tags
  }

  /** Возвращает непустой scalar attribute как строку. */
  private _attributeText(attributes: DiagnosticsAttributes, key: string): string | undefined {
    const value = attributes[key]
    if (Array.isArray(value) || value == null)
      return undefined
    const text = String(value).trim()
    return text || undefined
  }

  /** Возвращает положительное целое число или fallback. */
  private _normalizePositiveInteger(value: unknown, fallback: number): number {
    const normalized = Number(value)
    return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : fallback
  }

  /** Создаёт 128-bit Sentry event id в lowercase hexadecimal representation. */
  private _createEventId(): string {
    const bytes = new Uint8Array(16)
    if (globalThis.crypto?.getRandomValues)
      globalThis.crypto.getRandomValues(bytes)
    else
      bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
    return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
  }

  /** Проверяет, что unknown value является plain record. */
  private _isRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value)
  }
}

/** Factory встроенного Sentry adapter. */
export const SENTRY_DIAGNOSTICS_ADAPTER_FACTORY: DiagnosticsAdapterFactory = {
  type: 'sentry',
  capabilities: {
    records: true,
    snapshots: true,
    test: true,
  },
  create: (output, context) => new SentryDiagnosticsAdapter(output, context),
}
