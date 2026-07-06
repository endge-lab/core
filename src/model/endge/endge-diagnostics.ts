import { DiagnosticsRecordStore } from '@/domain/entities/diagnostics/DiagnosticsRecordStore'
import { DiagnosticsSpan } from '@/domain/entities/diagnostics/DiagnosticsSpan'
import { DiagnosticsTrace } from '@/domain/entities/diagnostics/DiagnosticsTrace'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { rndHex } from '@/domain/entities/debug/tools/base'
import type {
  DiagnosticsAttrs,
  DiagnosticsContextRef,
  DiagnosticsCounters,
  DiagnosticsEventRecord,
  DiagnosticsExporter,
  DiagnosticsLevel,
  DiagnosticsMeasurementRecord,
  DiagnosticsPolicy,
  DiagnosticsRecord,
  DiagnosticsRecordQuery,
  DiagnosticsScopeOptions,
  DiagnosticsSnapshot,
  DiagnosticsSnapshotRecord,
  DiagnosticsSpanEndRecord,
  DiagnosticsSpanStartRecord,
  DiagnosticsTraceEndRecord,
  DiagnosticsTraceStartRecord,
} from '@/domain/types/diagnostics.types'

const LEVEL_WEIGHT: Record<DiagnosticsLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
}

const DEFAULT_POLICY: DiagnosticsPolicy = {
  // Модуль присутствует в федерации всегда, но по умолчанию не создает runtime-нагрузку.
  enabled: false,
  levelThreshold: 'info',
  sampleRate: 1,
  maxRecords: 10_000,
  includeChannels: [],
  excludeChannels: [],
  exportersEnabled: false,
  persistPolicy: true,
}

function clampSampleRate(value: number): number {
  if (!Number.isFinite(value))
    return 1
  return Math.min(1, Math.max(0, value))
}

function normalizeChannel(value: string | undefined): string | undefined {
  const next = String(value ?? '').trim()
  return next || undefined
}

function normalizeAttrs(attrs: DiagnosticsAttrs | undefined): DiagnosticsAttrs | undefined {
  if (!attrs)
    return undefined

  const out: DiagnosticsAttrs = {}
  for (const [key, value] of Object.entries(attrs)) {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey)
      continue
    out[normalizedKey] = value
  }

  return Object.keys(out).length > 0 ? out : undefined
}

function mergeContext(
  base: DiagnosticsContextRef | undefined,
  patch: Partial<DiagnosticsContextRef> | undefined,
  sessionId: string,
): DiagnosticsContextRef | undefined {
  const out: DiagnosticsContextRef = {
    ...(base ?? {}),
    ...(patch ?? {}),
  }

  if (!out.sessionId)
    out.sessionId = sessionId

  return Object.values(out).some(value => value != null && String(value).trim() !== '')
    ? out
    : undefined
}

/**
 * Модуль диагностики Endge.
 * Хранит traces/spans/events, политику сбора и экспорт диагностических записей.
 */
export class EndgeDiagnostics extends EndgeModule {
  // Политика и store разделены, чтобы runtime мог менять лимиты и фильтры без пересоздания модуля.
  private _policy: DiagnosticsPolicy = { ...DEFAULT_POLICY }
  private _store: DiagnosticsRecordStore = new DiagnosticsRecordStore(DEFAULT_POLICY.maxRecords)
  private readonly _exporters = new Map<string, DiagnosticsExporter>()
  private readonly _recordListeners = new Set<(record: DiagnosticsRecord) => void>()
  private _sessionId = `diag-${rndHex(16)}`
  private _recordId = 0
  private _droppedByPolicy = 0
  private _droppedByCapacity = 0
  private _openTraces = 0
  private _openSpans = 0
  private _notifyScheduled = false

  /**
   * Возвращает идентификатор текущей диагностической сессии.
   */
  public get sessionId(): string {
    return this._sessionId
  }

  /**
   * Возвращает копию текущей политики сбора диагностики.
   */
  public get policy(): DiagnosticsPolicy {
    return { ...this._policy }
  }

  /**
   * Сериализует persistable-часть состояния диагностики.
   */
  public override serialize(): unknown {
    if (!this._policy.persistPolicy)
      return undefined

    return { policy: this._policy }
  }

  /**
   * Восстанавливает политику диагностики из сохраненного snapshot.
   */
  public override deserialize(payload: unknown): void {
    const raw = payload as { policy?: Partial<DiagnosticsPolicy> } | undefined
    if (!raw?.policy)
      return
    this.setPolicy(raw.policy)
  }

  /**
   * Сбрасывает накопленные диагностические записи и runtime-счетчики.
   */
  public override reset(): void {
    this._store.clear()
    this._exporters.clear()
    this._sessionId = `diag-${rndHex(16)}`
    this._recordId = 0
    this._droppedByPolicy = 0
    this._droppedByCapacity = 0
    this._openTraces = 0
    this._openSpans = 0
    this.scheduleNotify()
  }

  /**
   * Обновляет политику сбора, лимиты и фильтры диагностики.
   */
  public setPolicy(next: Partial<DiagnosticsPolicy>): void {
    this._policy = {
      ...this._policy,
      ...next,
      sampleRate: clampSampleRate(Number(next.sampleRate ?? this._policy.sampleRate)),
      maxRecords: Math.max(1, Math.floor(Number(next.maxRecords ?? this._policy.maxRecords) || DEFAULT_POLICY.maxRecords)),
      includeChannels: Array.isArray(next.includeChannels) ? next.includeChannels.map(channel => String(channel).trim()).filter(Boolean) : this._policy.includeChannels,
      excludeChannels: Array.isArray(next.excludeChannels) ? next.excludeChannels.map(channel => String(channel).trim()).filter(Boolean) : this._policy.excludeChannels,
    }

    this._store.setCapacity(this._policy.maxRecords)
    this.scheduleNotify()
  }

  /**
   * Регистрирует exporter для внешней отправки диагностических записей.
   */
  public registerExporter(exporter: DiagnosticsExporter): void {
    const id = String(exporter?.id ?? '').trim()
    if (!id)
      return

    this._exporters.set(id, exporter)
    this.scheduleNotify()
  }

  /**
   * Удаляет exporter по его id.
   */
  public unregisterExporter(exporterId: string): void {
    if (this._exporters.delete(String(exporterId ?? '').trim()))
      this.scheduleNotify()
  }

  /**
   * Подписывает listener на каждую новую диагностическую запись.
   */
  public addRecordListener(fn: (record: DiagnosticsRecord) => void): void {
    if (typeof fn === 'function')
      this._recordListeners.add(fn)
  }

  /**
   * Снимает listener диагностических записей.
   */
  public removeRecordListener(fn: (record: DiagnosticsRecord) => void): void {
    this._recordListeners.delete(fn)
  }

  /**
   * Trace - корневая операция, в которую группируются span и event-записи.
   */
  public beginTrace(name: string, options: DiagnosticsScopeOptions = {}): DiagnosticsTrace {
    const traceName = String(name ?? '').trim() || 'trace'
    const level = options.level ?? 'info'
    const channel = normalizeChannel(options.channel)
    const attrs = normalizeAttrs(options.attrs)
    const entities = options.entities
    const context = mergeContext(undefined, options.context, this._sessionId)
    const traceId = rndHex(32)
    const startedAt = Date.now()

    if (!this.canCapture(level, channel))
      return new DiagnosticsTrace(this, false, traceId, traceName, channel, level, startedAt, attrs, entities, context)

    const record: DiagnosticsTraceStartRecord = {
      id: this.nextRecordId(),
      ts: startedAt,
      level,
      kind: 'trace-start',
      name: traceName,
      channel,
      corr: { traceId },
      attrs,
      entities,
      context,
    }

    this.appendRecord(record)
    this._openTraces += 1

    return new DiagnosticsTrace(this, true, traceId, traceName, channel, level, startedAt, attrs, entities, context)
  }

  /**
   * Открывает дочерний span внутри trace.
   */
  public startSpan(
    name: string,
    options: DiagnosticsScopeOptions & { traceId: string, parentSpanId?: string } = {
      traceId: '',
    },
  ): DiagnosticsSpan {
    const spanName = String(name ?? '').trim() || 'span'
    const traceId = String(options.traceId ?? '').trim() || rndHex(32)
    const spanId = rndHex(16)
    const parentSpanId = String(options.parentSpanId ?? '').trim() || undefined
    const level = options.level ?? 'info'
    const channel = normalizeChannel(options.channel)
    const attrs = normalizeAttrs(options.attrs)
    const entities = options.entities
    const context = mergeContext(undefined, options.context, this._sessionId)
    const startedAt = Date.now()

    if (!this.canCapture(level, channel))
      return this.createInactiveSpan(traceId, parentSpanId)

    const record: DiagnosticsSpanStartRecord = {
      id: this.nextRecordId(),
      ts: startedAt,
      level,
      kind: 'span-start',
      name: spanName,
      channel,
      corr: {
        traceId,
        spanId,
        parentSpanId,
      },
      attrs,
      entities,
      context,
    }

    this.appendRecord(record)
    this._openSpans += 1

    return new DiagnosticsSpan(this, true, traceId, spanId, parentSpanId, spanName, channel, level, startedAt, attrs, entities, context)
  }

  /**
   * Создает неактивный span, когда policy не разрешает запись.
   */
  public createInactiveSpan(traceId: string, parentSpanId: string | undefined): DiagnosticsSpan {
    return new DiagnosticsSpan(this, false, traceId, undefined, parentSpanId, 'inactive', undefined, 'info', Date.now(), undefined, undefined, undefined)
  }

  /**
   * Записывает диагностическое событие.
   */
  public writeEvent(input: {
    message: string
    level: DiagnosticsLevel
    channel?: string
    attrs?: DiagnosticsAttrs
    entities?: DiagnosticsScopeOptions['entities']
    context?: DiagnosticsContextRef
    traceId: string
    spanId?: string
    data?: unknown
    error?: unknown
  }): void {
    if (!this.canCapture(input.level, input.channel))
      return

    const record: DiagnosticsEventRecord = {
      id: this.nextRecordId(),
      ts: Date.now(),
      level: input.level,
      kind: 'event',
      channel: normalizeChannel(input.channel),
      message: String(input.message ?? ''),
      corr: {
        traceId: String(input.traceId ?? '').trim() || rndHex(32),
        spanId: String(input.spanId ?? '').trim() || undefined,
      },
      attrs: normalizeAttrs(input.attrs),
      entities: input.entities,
      context: input.context,
      data: input.data,
      error: input.error,
    }

    this.appendRecord(record)
  }

  /**
   * Записывает числовое измерение.
   */
  public writeMeasurement(input: {
    name: string
    value: number
    unit?: string
    level: DiagnosticsLevel
    channel?: string
    attrs?: DiagnosticsAttrs
    entities?: DiagnosticsScopeOptions['entities']
    context?: DiagnosticsContextRef
    traceId: string
    spanId?: string
  }): void {
    if (!this.canCapture(input.level, input.channel))
      return

    const record: DiagnosticsMeasurementRecord = {
      id: this.nextRecordId(),
      ts: Date.now(),
      level: input.level,
      kind: 'measurement',
      channel: normalizeChannel(input.channel),
      name: String(input.name ?? '').trim() || 'measurement',
      value: Number.isFinite(input.value) ? input.value : 0,
      unit: String(input.unit ?? '').trim() || undefined,
      corr: {
        traceId: String(input.traceId ?? '').trim() || rndHex(32),
        spanId: String(input.spanId ?? '').trim() || undefined,
      },
      attrs: normalizeAttrs(input.attrs),
      entities: input.entities,
      context: input.context,
    }

    this.appendRecord(record)
  }

  /**
   * Записывает snapshot произвольного payload.
   */
  public writeSnapshot(input: {
    name: string
    payload?: unknown
    level: DiagnosticsLevel
    channel?: string
    attrs?: DiagnosticsAttrs
    entities?: DiagnosticsScopeOptions['entities']
    context?: DiagnosticsContextRef
    traceId: string
    spanId?: string
  }): void {
    if (!this.canCapture(input.level, input.channel))
      return

    const record: DiagnosticsSnapshotRecord = {
      id: this.nextRecordId(),
      ts: Date.now(),
      level: input.level,
      kind: 'snapshot',
      channel: normalizeChannel(input.channel),
      name: String(input.name ?? '').trim() || 'snapshot',
      payload: input.payload,
      corr: {
        traceId: String(input.traceId ?? '').trim() || rndHex(32),
        spanId: String(input.spanId ?? '').trim() || undefined,
      },
      attrs: normalizeAttrs(input.attrs),
      entities: input.entities,
      context: input.context,
    }

    this.appendRecord(record)
  }

  /**
   * Записывает завершение trace и закрывает внутренний счетчик открытых trace.
   */
  public writeTraceEnd(input: {
    name: string
    level: DiagnosticsLevel
    channel?: string
    attrs?: DiagnosticsAttrs
    entities?: DiagnosticsScopeOptions['entities']
    context?: DiagnosticsContextRef
    traceId: string
    durMs: number
  }): void {
    // Trace обязан закрыть внутреннее состояние даже если запись конца была отфильтрована policy.
    this._openTraces = Math.max(0, this._openTraces - 1)
    if (!this.canCapture(input.level, input.channel))
      return

    const record: DiagnosticsTraceEndRecord = {
      id: this.nextRecordId(),
      ts: Date.now(),
      level: input.level,
      kind: 'trace-end',
      channel: normalizeChannel(input.channel),
      name: String(input.name ?? '').trim() || 'trace',
      corr: {
        traceId: String(input.traceId ?? '').trim() || rndHex(32),
      },
      attrs: normalizeAttrs(input.attrs),
      entities: input.entities,
      context: input.context,
      durMs: Math.max(0, Math.round(Number(input.durMs) || 0)),
    }

    this.appendRecord(record)
  }

  /**
   * Записывает завершение span и закрывает внутренний счетчик открытых span.
   */
  public writeSpanEnd(input: {
    name: string
    level: DiagnosticsLevel
    channel?: string
    attrs?: DiagnosticsAttrs
    entities?: DiagnosticsScopeOptions['entities']
    context?: DiagnosticsContextRef
    traceId: string
    spanId?: string
    parentSpanId?: string
    durMs: number
  }): void {
    // Span тоже должен корректно закрываться независимо от динамического изменения policy.
    this._openSpans = Math.max(0, this._openSpans - 1)
    if (!this.canCapture(input.level, input.channel))
      return

    const record: DiagnosticsSpanEndRecord = {
      id: this.nextRecordId(),
      ts: Date.now(),
      level: input.level,
      kind: 'span-end',
      channel: normalizeChannel(input.channel),
      name: String(input.name ?? '').trim() || 'span',
      corr: {
        traceId: String(input.traceId ?? '').trim() || rndHex(32),
        spanId: String(input.spanId ?? '').trim() || undefined,
        parentSpanId: String(input.parentSpanId ?? '').trim() || undefined,
      },
      attrs: normalizeAttrs(input.attrs),
      entities: input.entities,
      context: input.context,
      durMs: Math.max(0, Math.round(Number(input.durMs) || 0)),
    }

    this.appendRecord(record)
  }

  /**
   * Возвращает диагностическую запись по id.
   */
  public getRecord(recordId: number): DiagnosticsRecord | null {
    return this._store.getById(recordId)
  }

  /**
   * Возвращает последние диагностические записи.
   */
  public getRecords(limit?: number): DiagnosticsRecord[] {
    return this._store.toArray(limit)
  }

  /**
   * Возвращает записи, относящиеся к trace.
   */
  public getTraceRecords(traceId: string, limit?: number): DiagnosticsRecord[] {
    return this._store.getByTraceId(traceId, limit)
  }

  /**
   * Возвращает записи, связанные с доменной или runtime-сущностью.
   */
  public getEntityRecords(type: string, id: string, limit?: number): DiagnosticsRecord[] {
    return this._store.getByEntity(type, id, limit)
  }

  /**
   * Выполняет фильтрованный запрос по диагностическим записям.
   */
  public queryRecords(query: DiagnosticsRecordQuery = {}): DiagnosticsRecord[] {
    const limit = query.limit != null ? Math.max(1, Math.floor(query.limit)) : undefined

    let source: DiagnosticsRecord[]
    if (query.traceId)
      source = this._store.getByTraceId(query.traceId, limit)
    else if (query.entity)
      source = this._store.getByEntity(query.entity.type, query.entity.id, limit)
    else if (query.channel)
      source = this._store.getByChannel(query.channel, limit)
    else
      source = this._store.toArray(limit)

    return source.filter((record) => {
      if (query.channel && normalizeChannel(record.channel) !== normalizeChannel(query.channel))
        return false
      if (query.levelAtLeast && LEVEL_WEIGHT[record.level] < LEVEL_WEIGHT[query.levelAtLeast])
        return false
      return true
    })
  }

  /**
   * Возвращает агрегированные счетчики диагностики.
   */
  public getCounters(): DiagnosticsCounters {
    return {
      totalRecords: this._store.size,
      droppedByPolicy: this._droppedByPolicy,
      droppedByCapacity: this._droppedByCapacity,
      activeExporters: this._exporters.size,
      openTraces: this._openTraces,
      openSpans: this._openSpans,
      recordsByKind: this._store.getRecordsByKind(),
      recordsByChannel: this._store.getRecordsByChannel(),
    }
  }

  /**
   * Возвращает snapshot состояния диагностики.
   */
  public snapshot(options: { includeRecords?: boolean, limit?: number } = {}): DiagnosticsSnapshot {
    return {
      sessionId: this._sessionId,
      policy: this.policy,
      counters: this.getCounters(),
      records: options.includeRecords === true ? this.getRecords(options.limit) : undefined,
    }
  }

  /**
   * Отправляет накопленные записи во все активные exporters.
   */
  public async flushExporters(options: { limit?: number } = {}): Promise<void> {
    if (!this._policy.exportersEnabled || this._exporters.size === 0)
      return

    const records = this.getRecords(options.limit)
    if (records.length === 0)
      return

    const meta = {
      sessionId: this._sessionId,
      exportedAt: Date.now(),
    }

    for (const exporter of this._exporters.values())
      await exporter.export(records, meta)
  }

  /**
   * Проверяет, разрешает ли текущая policy записать событие указанного уровня и канала.
   */
  public canCapture(level: DiagnosticsLevel, channel?: string): boolean {
    if (!this._policy.enabled) {
      this._droppedByPolicy += 1
      return false
    }

    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this._policy.levelThreshold]) {
      this._droppedByPolicy += 1
      return false
    }

    const normalizedChannel = normalizeChannel(channel)
    if (normalizedChannel && this._policy.excludeChannels.includes(normalizedChannel)) {
      this._droppedByPolicy += 1
      return false
    }

    if (this._policy.includeChannels.length > 0 && (!normalizedChannel || !this._policy.includeChannels.includes(normalizedChannel))) {
      this._droppedByPolicy += 1
      return false
    }

    if (level !== 'warn' && level !== 'error' && level !== 'fatal' && this._policy.sampleRate < 1 && Math.random() > this._policy.sampleRate) {
      this._droppedByPolicy += 1
      return false
    }

    return true
  }

  /**
   * Внутренний helper модуля: append Record.
   */
  private appendRecord(record: DiagnosticsRecord): void {
    const evicted = this._store.append(record)
    if (evicted)
      this._droppedByCapacity += 1
    this.scheduleNotify()
    for (const fn of this._recordListeners)
      fn(record)
  }

  /**
   * Внутренний helper модуля: next Record Id.
   */
  private nextRecordId(): number {
    this._recordId += 1
    return this._recordId
  }

  /**
   * Внутренний helper модуля: schedule Notify.
   */
  private scheduleNotify(): void {
    if (this._notifyScheduled)
      return

    this._notifyScheduled = true
    // Подписчики получают одну batched-нотификацию на microtask, а не notify на каждый record.
    queueMicrotask(() => {
      this._notifyScheduled = false
      this.notify()
    })
  }
}
