/** Сигналы, которые поддерживает первая версия модуля диагностики. */
export type DiagnosticsSignal = 'log' | 'span'

/** Фаза жизненного цикла, в которой создана диагностическая запись. */
export type DiagnosticsPhase = 'authoring' | 'build' | 'runtime'

/** Базовые значения OpenTelemetry SeverityNumber, используемые публичным API. */
export type DiagnosticsSeverityNumber = 1 | 5 | 9 | 13 | 17 | 21

/** Скалярное значение диагностического атрибута. */
export type DiagnosticsAttributeScalar = string | number | boolean

/** Допустимое значение диагностического атрибута. */
export type DiagnosticsAttributeValue = DiagnosticsAttributeScalar | DiagnosticsAttributeScalar[]

/** Плоские структурированные атрибуты записи. */
export type DiagnosticsAttributes = Record<string, DiagnosticsAttributeValue>

/** Синхронный provider общих attributes, актуальных в момент создания record. */
export type DiagnosticsContextProvider = () => DiagnosticsAttributes

/** Фаза, в которой обнаружена актуальная проблема системы. */
export type DiagnosticsProblemPhase = DiagnosticsPhase

/** Уровень актуальной проблемы, независимый от OTel SeverityNumber. */
export type DiagnosticsProblemSeverity = 'info' | 'warning' | 'error' | 'fatal'

/** Стабильная ссылка на доменную сущность без ограничения compiled ProgramEntityType. */
export interface DiagnosticsEntityRef {
  entityType: string
  id: string | number
  identity: string
}

/** Владелец replaceable-набора проблем. */
export interface DiagnosticsProblemOwner {
  /** Уникальный ключ владельца внутри problem registry. */
  key: string
  /** Фаза жизненного цикла, к которой относится набор. */
  phase: DiagnosticsProblemPhase
  /** Доменная сущность, если проблема связана с persisted document. */
  entityRef?: DiagnosticsEntityRef
  /** Runtime instance, если проблема относится к живому host. */
  runtimeId?: string
}

/** Вход одной проблемы до добавления owner и временных метаданных registry. */
export interface DiagnosticsProblemInput {
  /** Стабильный ключ проблемы внутри одного owner; при отсутствии выводится из содержимого. */
  key?: string
  severity: DiagnosticsProblemSeverity
  code: string
  message: string
  sourcePath?: string
  start?: number
  end?: number
  attributes?: DiagnosticsAttributes
  traceId?: string
  recordId?: number
}

/** Актуальная проблема, нормализованная problem registry. */
export interface DiagnosticsProblem extends Omit<DiagnosticsProblemInput, 'key'> {
  /** Стабильный id в формате `<owner.key>:<problem.key>`. */
  id: string
  /** Ключ проблемы внутри owner. */
  key: string
  owner: DiagnosticsProblemOwner
  updatedAt: number
}

/** Условия выбора актуальных проблем. */
export interface DiagnosticsProblemFilter {
  ownerKeys?: string[]
  phases?: DiagnosticsProblemPhase[]
  severities?: DiagnosticsProblemSeverity[]
  entityTypes?: string[]
  entityId?: string | number
  entityIdentity?: string
  runtimeId?: string
  codes?: string[]
}

/** Snapshot replaceable problem registry. */
export interface DiagnosticsProblemsSnapshot {
  revision: number
  total: number
  problems: readonly DiagnosticsProblem[]
}

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
  phase?: DiagnosticsPhase
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

/** JSON-safe значение persisted options конкретного adapter. */
export type DiagnosticsAdapterOptionValue =
  | string
  | number
  | boolean
  | null
  | DiagnosticsAdapterOptionValue[]
  | { [key: string]: DiagnosticsAdapterOptionValue }

/** Именованный канал вывода, создаваемый через adapter registry. */
export interface EndgeDiagnosticsOutputConfiguration {
  id: string
  name: string
  enabled: boolean
  adapterType: string
  options: Record<string, DiagnosticsAdapterOptionValue>
}

/** Условия выбора records для подписки или route. */
export interface DiagnosticsFilter {
  signals?: DiagnosticsSignal[]
  phases?: DiagnosticsPhase[]
  minSeverity?: DiagnosticsSeverityNumber
  spanStatuses?: DiagnosticsSpanStatus['code'][]
  minDurationMs?: number
  scopes?: string[]
  eventNames?: string[]
  traceId?: string
  spanId?: string
  attributes?: DiagnosticsAttributes
  limit?: number
}

/** Декларативное правило доставки records в adapter. */
export interface EndgeDiagnosticsRoute {
  id: string
  name: string
  enabled: boolean
  match: DiagnosticsFilter
  outputId: string
}

/** Effective configuration сбора и внешней доставки telemetry. */
export interface EndgeDiagnosticsTelemetryConfiguration {
  collection: EndgeDiagnosticsCollectionConfiguration
  outputs: EndgeDiagnosticsOutputConfiguration[]
  routes: EndgeDiagnosticsRoute[]
}

/** Состав JSON snapshot по умолчанию. */
export interface EndgeDiagnosticsSnapshotContentConfiguration {
  telemetry: boolean
  problems: boolean
  configuration: boolean
}

/** Условия автоматического snapshot по ERROR/FATAL records. */
export interface EndgeDiagnosticsAutomaticSnapshotConfiguration {
  enabled: boolean
  errorCount: number
  windowSeconds: number
  cooldownSeconds: number
  outputIds: string[]
}

/** Effective configuration ручных и автоматических snapshots. */
export interface EndgeDiagnosticsSnapshotsConfiguration {
  content: EndgeDiagnosticsSnapshotContentConfiguration
  automatic: EndgeDiagnosticsAutomaticSnapshotConfiguration
}

/** Полная effective configuration модуля диагностики. */
export interface EndgeDiagnosticsConfiguration {
  telemetry: EndgeDiagnosticsTelemetryConfiguration
  snapshots: EndgeDiagnosticsSnapshotsConfiguration
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
  phase?: DiagnosticsPhase
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
  phase?: DiagnosticsPhase
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
  contextProviderFailures: number
  activeAdapters: number
  activeContextProviders: number
  activeSpans: number
  recordsBySignal: Partial<Record<DiagnosticsSignal, number>>
  recordsByScope: Record<string, number>
}

/** Параметры создания JSON-safe snapshot. */
export interface DiagnosticsSnapshotOptions {
  trigger?: 'manual' | 'automatic'
  includeTelemetry?: boolean
  includeProblems?: boolean
  includeConfiguration?: boolean
  filter?: DiagnosticsFilter
}

/** Telemetry-часть диагностического snapshot. */
export interface DiagnosticsTelemetrySnapshot {
  sessionId: string
  resource: DiagnosticsResource
  counters: DiagnosticsCounters
  records: readonly DiagnosticsRecord[]
}

/** JSON-safe snapshot текущего состояния diagnostics facade. */
export interface DiagnosticsSnapshot {
  generatedAt: number
  trigger: 'manual' | 'automatic'
  telemetry?: DiagnosticsTelemetrySnapshot
  problems?: DiagnosticsProblemsSnapshot
  configuration?: EndgeDiagnosticsConfiguration
}

/** Обработчик одной принятой диагностической записи. */
export type DiagnosticsListener = (record: DiagnosticsRecord) => void

/** Параметры подписки на diagnostics stream. */
export interface DiagnosticsSubscribeOptions {
  replayStored?: boolean
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
    phase?: DiagnosticsPhase
    name: string
    scope: DiagnosticsInstrumentationScope
    startTimestamp: number
    attributes: DiagnosticsAttributes
    options?: DiagnosticsSpanEndOptions
  }): DiagnosticsSpanRecord | null
}
