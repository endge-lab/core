import type { DiagnosticsSpan } from '@/domain/entities/diagnostics/DiagnosticsSpan'

/**
 * Уровни диагностики упорядочены от самого подробного к самому критичному.
 * Политика модуля может отсекать всё, что ниже заданного порога.
 */
export type DiagnosticsLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/**
 * Канонические типы record внутри модуля.
 * Модуль оперирует только ими и не знает ничего о UI-представлениях.
 */
export type DiagnosticsRecordKind =
  | 'trace-start'
  | 'trace-end'
  | 'span-start'
  | 'span-end'
  | 'event'
  | 'measurement'
  | 'snapshot'

export type DiagnosticsScalar = string | number | boolean | null | undefined

/**
 * Плоские атрибуты record.
 * Здесь не должно быть тяжёлых объектов, чтобы запись оставалась дешёвой.
 */
export type DiagnosticsAttrs = Record<string, DiagnosticsScalar>

/**
 * Ссылка на сущность ядра, к которой относится запись.
 */
export interface DiagnosticsEntityRef {
  type: string
  id: string
  attrs?: DiagnosticsAttrs
}

/**
 * Контекст выполнения, независимый от UI-фреймворков.
 */
export interface DiagnosticsContextRef {
  module?: string
  runtimeId?: string
  project?: string
  environment?: string
  tenantId?: string
  userId?: string
  sessionId?: string
}

export interface DiagnosticsCorrelation {
  traceId: string
  spanId?: string
  parentSpanId?: string
}

/**
 * Базовая форма любой диагностической записи.
 */
export interface DiagnosticsRecordBase {
  id: number
  ts: number
  level: DiagnosticsLevel
  kind: DiagnosticsRecordKind
  channel?: string
  name?: string
  corr?: DiagnosticsCorrelation
  attrs?: DiagnosticsAttrs
  entities?: DiagnosticsEntityRef[]
  context?: DiagnosticsContextRef
}

export interface DiagnosticsTraceStartRecord extends DiagnosticsRecordBase {
  kind: 'trace-start'
  name: string
  corr: DiagnosticsCorrelation
}

export interface DiagnosticsTraceEndRecord extends DiagnosticsRecordBase {
  kind: 'trace-end'
  name: string
  corr: DiagnosticsCorrelation
  durMs: number
}

export interface DiagnosticsSpanStartRecord extends DiagnosticsRecordBase {
  kind: 'span-start'
  name: string
  corr: DiagnosticsCorrelation
}

export interface DiagnosticsSpanEndRecord extends DiagnosticsRecordBase {
  kind: 'span-end'
  name: string
  corr: DiagnosticsCorrelation
  durMs: number
}

export interface DiagnosticsEventRecord extends DiagnosticsRecordBase {
  kind: 'event'
  message: string
  data?: unknown
  error?: unknown
}

export interface DiagnosticsMeasurementRecord extends DiagnosticsRecordBase {
  kind: 'measurement'
  name: string
  value: number
  unit?: string
}

export interface DiagnosticsSnapshotRecord extends DiagnosticsRecordBase {
  kind: 'snapshot'
  name: string
  payload?: unknown
}

export type DiagnosticsRecord =
  | DiagnosticsTraceStartRecord
  | DiagnosticsTraceEndRecord
  | DiagnosticsSpanStartRecord
  | DiagnosticsSpanEndRecord
  | DiagnosticsEventRecord
  | DiagnosticsMeasurementRecord
  | DiagnosticsSnapshotRecord

export interface DiagnosticsScopeOptions {
  level?: DiagnosticsLevel
  channel?: string
  attrs?: DiagnosticsAttrs
  entities?: DiagnosticsEntityRef[]
  context?: Partial<DiagnosticsContextRef>
}

export interface DiagnosticsEventOptions extends DiagnosticsScopeOptions {
  data?: unknown
  error?: unknown
}

export interface DiagnosticsMeasurementOptions extends DiagnosticsScopeOptions {
  unit?: string
}

export interface DiagnosticsSnapshotOptions extends DiagnosticsScopeOptions {
  payload?: unknown
}

export interface DiagnosticsPolicy {
  enabled: boolean
  levelThreshold: DiagnosticsLevel
  sampleRate: number
  maxRecords: number
  includeChannels: string[]
  excludeChannels: string[]
  exportersEnabled: boolean
  persistPolicy: boolean
}

export interface DiagnosticsCounters {
  totalRecords: number
  droppedByPolicy: number
  droppedByCapacity: number
  activeExporters: number
  openTraces: number
  openSpans: number
  recordsByKind: Partial<Record<DiagnosticsRecordKind, number>>
  recordsByChannel: Record<string, number>
}

export interface DiagnosticsRecordQuery {
  traceId?: string
  entity?: { type: string, id: string }
  channel?: string
  levelAtLeast?: DiagnosticsLevel
  limit?: number
}

/**
 * Полный snapshot модуля для чтения извне.
 * По умолчанию records можно не включать, чтобы дешево получать только состояние.
 */
export interface DiagnosticsSnapshot {
  sessionId: string
  policy: DiagnosticsPolicy
  counters: DiagnosticsCounters
  records?: DiagnosticsRecord[]
}

export interface DiagnosticsScopeWriter {
  readonly sessionId: string
  writeEvent(input: {
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
  }): void
  writeMeasurement(input: {
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
  }): void
  writeSnapshot(input: {
    name: string
    payload?: unknown
    level: DiagnosticsLevel
    channel?: string
    attrs?: DiagnosticsAttrs
    entities?: DiagnosticsScopeOptions['entities']
    context?: DiagnosticsContextRef
    traceId: string
    spanId?: string
  }): void
}

export interface DiagnosticsSpanOwner extends DiagnosticsScopeWriter {
  startSpan(
    name: string,
    options: DiagnosticsScopeOptions & { traceId: string, parentSpanId?: string },
  ): DiagnosticsSpan
  createInactiveSpan(traceId: string, parentSpanId: string | undefined): DiagnosticsSpan
  writeSpanEnd(input: {
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
  }): void
}

export interface DiagnosticsTraceOwner extends DiagnosticsScopeWriter {
  startSpan(
    name: string,
    options: DiagnosticsScopeOptions & { traceId: string, parentSpanId?: string },
  ): DiagnosticsSpan
  createInactiveSpan(traceId: string, parentSpanId: string | undefined): DiagnosticsSpan
  writeTraceEnd(input: {
    name: string
    level: DiagnosticsLevel
    channel?: string
    attrs?: DiagnosticsAttrs
    entities?: DiagnosticsScopeOptions['entities']
    context?: DiagnosticsContextRef
    traceId: string
    durMs: number
  }): void
}

export interface DiagnosticsExporter {
  id: string
  export(records: readonly DiagnosticsRecord[], meta: { sessionId: string, exportedAt: number }): void | Promise<void>
}
