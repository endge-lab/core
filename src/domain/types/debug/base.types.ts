/**
 * Уровни логирования
 */
export type LogLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'success'
  | 'warn'
  | 'error'
  | 'fatal'

/**
 * Тип записи
 */
export type LogKind = 'span_start' | 'span_end' | 'event'

/**
 * Корреляция (совместимо с W3C TraceContext по смыслу)
 */
export interface Correlation {
  traceId?: string // 32 hex (логически)
  spanId?: string // 16 hex (логически)
  parentSpanId?: string
}

/**
 * Плоские атрибуты (namespace dotted keys)
 */
export type Attrs = Record<string, string | number | boolean | null | undefined>

/**
 * Ссылка на сущность/ресурс
 */
export interface EntityRef {
  type: string
  id: string
  attrs?: Attrs
}

/**
 * Базовая запись
 */
export interface BaseRecord {
  ts: number
  level: LogLevel
  kind: LogKind
  /** lane присутствует у спанов/эвентов, но не обязателен у trace-спана */
  lane?: string
  /** человекочитаемое имя спана */
  name?: string
  /** корреляция (trace/span ids) */
  corr?: Correlation
  /** произвольные атрибуты */
  attrs?: Attrs
  /** связанные сущности */
  entities?: EntityRef[]
}

/**
 * Спан (начало)
 */
export interface SpanStart extends BaseRecord {
  kind: 'span_start'
  name: string
}

/**
 * Спан (конец)
 */
export interface SpanEnd extends BaseRecord {
  kind: 'span_end'
  name: string
  durMs: number
}

/**
 * Точечное событие внутри спана
 */
export interface EventRecord extends BaseRecord {
  kind: 'event'
  msg: string
  data?: unknown
  err?: unknown
}

/**
 * Объединённый тип записи журнала
 */
export type LogRecord = SpanStart | SpanEnd | EventRecord
