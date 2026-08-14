import type {
  DiagnosticsAdapter,
  DiagnosticsAdapterFactory,
  DiagnosticsAdapterRecordContext,
  DiagnosticsAdapterSnapshotContext,
} from '@/domain/types/diagnostics/diagnostics-adapter.type'
import type {
  DiagnosticsRecord,
  DiagnosticsSnapshot,
  EndgeDiagnosticsOutputConfiguration,
} from '@/domain/types/diagnostics/diagnostics.types'

type ConsoleFormat = 'pretty' | 'json'
const MAX_CONSOLE_TEXT_LENGTH = 2_000

function boundedConsoleText(value: string): string {
  return value.length <= MAX_CONSOLE_TEXT_LENGTH
    ? value
    : `${value.slice(0, MAX_CONSOLE_TEXT_LENGTH)}… [truncated ${value.length - MAX_CONSOLE_TEXT_LENGTH} chars]`
}

/** Системный adapter вывода diagnostics records и snapshots в console API. */
export class ConsoleDiagnosticsAdapter implements DiagnosticsAdapter {
  public readonly id: string
  private readonly _name: string
  private readonly _format: ConsoleFormat
  private readonly _groupByTrace: boolean
  private readonly _includeTimestamp: boolean
  private readonly _includeScope: boolean
  private readonly _includeAttributes: boolean

  /** Создаёт console adapter из JSON-safe output options. */
  public constructor(output: EndgeDiagnosticsOutputConfiguration) {
    this.id = output.id
    this._name = output.name
    this._format = output.options.format === 'json' ? 'json' : 'pretty'
    this._groupByTrace = output.options.groupByTrace === true
    this._includeTimestamp = output.options.includeTimestamp !== false
    this._includeScope = output.options.includeScope !== false
    this._includeAttributes = output.options.includeAttributes !== false
  }

  /** Выводит одну routed record в pretty или JSON формате. */
  public acceptRecord(record: DiagnosticsRecord, context: DiagnosticsAdapterRecordContext): void {
    if (this._format === 'json') {
      console.log(JSON.stringify({
        outputId: context.output.id,
        routeIds: context.routeIds,
        record: {
          id: record.id,
          signal: record.signal,
          scope: record.scope.name,
          phase: record.phase,
          traceId: record.traceId,
          attributeKeys: Object.keys(record.attributes),
          text: boundedConsoleText(record.signal === 'log' ? record.body : record.name),
        },
      }))
      return
    }

    const grouped = this._groupByTrace && Boolean(record.traceId) && typeof console.groupCollapsed === 'function'
    if (grouped)
      console.groupCollapsed(`[${this._name}] trace ${record.traceId}`)

    const parts = this._formatRecord(record)
    this._writeRecord(record, parts.message, parts.details)

    if (grouped)
      console.groupEnd()
  }

  /** Выводит bounded summary снимка, не сериализуя telemetry history целиком. */
  public acceptSnapshot(snapshot: DiagnosticsSnapshot, context: DiagnosticsAdapterSnapshotContext): void {
    console.log(JSON.stringify({
      outputId: context.output.id,
      generatedAt: snapshot.generatedAt,
      trigger: snapshot.trigger,
      telemetryRecords: snapshot.telemetry?.records.length ?? 0,
      problems: snapshot.problems?.total ?? 0,
      hasConfiguration: Boolean(snapshot.configuration),
    }))
  }

  /** Пишет безопасную тестовую строку без добавления record в diagnostics history. */
  public test(): void {
    console.info(`[Endge diagnostics] Канал «${this._name}» доступен`)
  }

  /** Формирует компактное сообщение и optional structured details. */
  private _formatRecord(record: DiagnosticsRecord): { message: string, details?: string } {
    const prefix: string[] = []
    if (this._includeTimestamp) {
      const timestamp = record.signal === 'log' ? record.timestamp : record.endTimestamp
      prefix.push(new Date(timestamp).toISOString())
    }
    prefix.push(record.signal === 'log' ? record.severityText : 'SPAN')
    if (record.phase)
      prefix.push(record.phase)
    if (this._includeScope)
      prefix.push(record.scope.name)

    const text = record.signal === 'log'
      ? boundedConsoleText(record.body)
      : `${record.name} ${record.durationMs}ms (${record.status.code})`
    const details = this._includeAttributes && Object.keys(record.attributes).length
      ? `attributes=[${Object.keys(record.attributes).join(', ')}]${record.traceId ? ` trace=${record.traceId}` : ''}${record.spanId ? ` span=${record.spanId}` : ''}`
      : undefined
    return { message: `[${prefix.join(' · ')}] ${text}`, ...(details ? { details } : {}) }
  }

  /** Выбирает подходящий console method по severity или span status. */
  private _writeRecord(record: DiagnosticsRecord, message: string, details?: string): void {
    const text = details ? `${message} ${details}` : message
    if (record.signal === 'span') {
      const writer = record.status.code === 'error' ? console.error : console.info
      writer(text)
      return
    }
    if (record.severityNumber >= 17)
      console.error(text)
    else if (record.severityNumber >= 13)
      console.warn(text)
    else if (record.severityNumber <= 5)
      console.debug(text)
    else
      console.info(text)
  }
}

/** Factory системного console adapter. */
export const CONSOLE_DIAGNOSTICS_ADAPTER_FACTORY: DiagnosticsAdapterFactory = {
  type: 'console',
  capabilities: {
    records: true,
    snapshots: true,
    test: true,
  },
  create: output => new ConsoleDiagnosticsAdapter(output),
}
