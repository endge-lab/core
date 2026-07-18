/** Сигналы, которые поддерживает первая версия модуля диагностики. */
export type DiagnosticsSignal = 'log' | 'span'

/** Базовые значения OpenTelemetry SeverityNumber, используемые публичным API. */
export type DiagnosticsSeverityNumber = 1 | 5 | 9 | 13 | 17 | 21

/** Скалярное значение диагностического атрибута. */
export type DiagnosticsAttributeScalar = string | number | boolean

/** Допустимое значение диагностического атрибута. */
export type DiagnosticsAttributeValue = DiagnosticsAttributeScalar | DiagnosticsAttributeScalar[]

/** Плоские структурированные атрибуты записи. */
export type DiagnosticsAttributes = Record<string, DiagnosticsAttributeValue>

/** Модуль или библиотека, создавшая запись. */
export interface DiagnosticsInstrumentationScope {
  name: string
  version?: string
}

/** Общие атрибуты текущего запуска Endge. */
export interface DiagnosticsResource {
  attributes: DiagnosticsAttributes
}

/** Статус завершённого span. */
export interface DiagnosticsSpanStatus {
  code: 'unset' | 'ok' | 'error'
  message?: string
}

/** Общие поля любой записи локального diagnostics store. */
export interface DiagnosticsRecordBase {
  id: number
  signal: DiagnosticsSignal
  scope: DiagnosticsInstrumentationScope
  attributes: DiagnosticsAttributes
  traceId?: string
  spanId?: string
  traceFlags?: number
}

/** Структурированный log record в формате, близком к OpenTelemetry. */
export interface DiagnosticsLogRecord extends DiagnosticsRecordBase {
  signal: 'log'
  timestamp: number
  observedTimestamp?: number
  severityNumber: DiagnosticsSeverityNumber
  severityText: 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'
  body: string
  eventName?: string
}

/** Один завершённый span; start/end records отдельно не сохраняются. */
export interface DiagnosticsSpanRecord extends DiagnosticsRecordBase {
  signal: 'span'
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  startTimestamp: number
  endTimestamp: number
  durationMs: number
  status: DiagnosticsSpanStatus
}

/** Объединённый тип записей модуля диагностики. */
export type DiagnosticsRecord = DiagnosticsLogRecord | DiagnosticsSpanRecord

/** Настройки локального сбора и bounded storage. */
export interface EndgeDiagnosticsCollectionConfiguration {
  enabled: boolean
  signals: DiagnosticsSignal[]
  minSeverity: DiagnosticsSeverityNumber
  maxRecords: number
}

/** Условия выбора records для подписки или route. */
export interface DiagnosticsFilter {
  signals?: DiagnosticsSignal[]
  minSeverity?: DiagnosticsSeverityNumber
  scopes?: string[]
  eventNames?: string[]
  traceId?: string
  spanId?: string
  attributes?: DiagnosticsAttributes
  limit?: number
}

/** Назначение route без хранения credentials внутри diagnostics configuration. */
export interface EndgeDiagnosticsRouteTarget {
  adapterId: string
  integrationId?: string
}

/** Декларативное правило доставки records в adapter. */
export interface EndgeDiagnosticsRoute {
  id: string
  enabled: boolean
  match: DiagnosticsFilter
  target: EndgeDiagnosticsRouteTarget
}

/** Полная effective configuration модуля диагностики. */
export interface EndgeDiagnosticsConfiguration {
  collection: EndgeDiagnosticsCollectionConfiguration
  routes: EndgeDiagnosticsRoute[]
}

/** Параметры записи log без выбранного уровня severity. */
export interface DiagnosticsLogOptions {
  timestamp?: number
  observedTimestamp?: number
  scope?: DiagnosticsInstrumentationScope
  eventName?: string
  attributes?: DiagnosticsAttributes
  traceId?: string
  spanId?: string
  traceFlags?: number
}

/** Полный input универсального метода log(). */
export interface DiagnosticsLogInput extends DiagnosticsLogOptions {
  body: string
  severityNumber: DiagnosticsSeverityNumber
}

/** Параметры структурированной записи исключения. */
export interface DiagnosticsExceptionOptions extends DiagnosticsLogOptions {
  severityNumber?: 17 | 21
}

/** Параметры создания root или child span. */
export interface DiagnosticsSpanOptions {
  scope?: DiagnosticsInstrumentationScope
  attributes?: DiagnosticsAttributes
  traceId?: string
  parentSpanId?: string
  traceFlags?: number
  startTimestamp?: number
}

/** Параметры завершения span. */
export interface DiagnosticsSpanEndOptions {
  status?: DiagnosticsSpanStatus['code']
  message?: string
  attributes?: DiagnosticsAttributes
  endTimestamp?: number
}

/** Публичный handle активного span. */
export interface DiagnosticsSpanHandle {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId?: string
  readonly isEnded: boolean

  /** Добавляет или переопределяет структурированные атрибуты активного span. */
  setAttributes(attributes: DiagnosticsAttributes): void
  /** Создаёт child span с унаследованными trace id и parent span id. */
  startChild(name: string, options?: Omit<DiagnosticsSpanOptions, 'traceId' | 'parentSpanId'>): DiagnosticsSpanHandle
  /** Записывает log, автоматически связанный с текущим span. */
  log(input: Omit<DiagnosticsLogInput, 'traceId' | 'spanId'>): DiagnosticsLogRecord | null
  /** Записывает exception log, автоматически связанный с текущим span. */
  recordException(error: unknown, options?: DiagnosticsExceptionOptions): DiagnosticsLogRecord | null
  /** Завершает span и сохраняет единственный итоговый span record. */
  end(options?: DiagnosticsSpanEndOptions): DiagnosticsSpanRecord | null
}

/** Счётчики текущей diagnostics session. */
export interface DiagnosticsCounters {
  totalRecords: number
  droppedByPolicy: number
  droppedByCapacity: number
  adapterFailures: number
  listenerFailures: number
  activeAdapters: number
  activeSpans: number
  recordsBySignal: Partial<Record<DiagnosticsSignal, number>>
  recordsByScope: Record<string, number>
}

/** Параметры создания read-only snapshot. */
export interface DiagnosticsSnapshotOptions {
  includeRecords?: boolean
  filter?: DiagnosticsFilter
}

/** Read-only snapshot текущей diagnostics session. */
export interface DiagnosticsSnapshot {
  sessionId: string
  configuration: EndgeDiagnosticsConfiguration
  resource: DiagnosticsResource
  counters: DiagnosticsCounters
  records?: readonly DiagnosticsRecord[]
}

/** Обработчик одной принятой диагностической записи. */
export type DiagnosticsListener = (record: DiagnosticsRecord) => void

/** Параметры подписки на diagnostics stream. */
export interface DiagnosticsSubscribeOptions {
  replayStored?: boolean
}

/** Контекст вызова adapter после применения route. */
export interface DiagnosticsAdapterContext {
  sessionId: string
  resource: DiagnosticsResource
  routeId: string
  integrationId?: string
}

/** Независимый adapter внешней доставки diagnostic records. */
export interface DiagnosticsAdapter {
  readonly id: string
  /** Принимает record, который прошёл matching конкретного route. */
  accept(record: DiagnosticsRecord, context: DiagnosticsAdapterContext): void | Promise<void>
  /** Доставляет накопленный adapter buffer без завершения diagnostics session. */
  flush?(): void | Promise<void>
  /** Освобождает внешние ресурсы adapter при отключении или reset. */
  dispose?(): void | Promise<void>
}

/** Результат best-effort flush всех зарегистрированных adapters. */
export interface DiagnosticsFlushResult {
  succeeded: string[]
  failed: Array<{ adapterId: string, error: unknown }>
}

/** Внутренний port, через который span пишет records в модуль. */
export interface DiagnosticsSpanOwner {
  /** Создаёт root или child span от имени handle. */
  startSpan(name: string, options?: DiagnosticsSpanOptions): DiagnosticsSpanHandle
  /** Записывает нормализованный log от имени handle. */
  log(input: DiagnosticsLogInput): DiagnosticsLogRecord | null
  /** Записывает нормализованное исключение от имени handle. */
  recordException(error: unknown, options?: DiagnosticsExceptionOptions): DiagnosticsLogRecord | null
  /** Финализирует активный span и создаёт итоговый record. */
  finishSpan(input: {
    traceId: string
    spanId: string
    parentSpanId?: string
    traceFlags?: number
    name: string
    scope: DiagnosticsInstrumentationScope
    startTimestamp: number
    attributes: DiagnosticsAttributes
    options?: DiagnosticsSpanEndOptions
  }): DiagnosticsSpanRecord | null
}
