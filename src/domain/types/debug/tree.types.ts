import type {
  Attrs,
  Correlation,
  EntityRef,
  LogLevel,
} from '@/domain/types/debug/base.types'

export interface BaseNode {
  kind: 'span' | 'event'
  ts: number
  level?: LogLevel
  lane?: string
  name?: string
  corr?: Correlation
  attrs?: Attrs
  entities?: EntityRef[]
}

/** Визуальный спан (объединяет start/end) */
export interface SpanNode extends BaseNode {
  kind: 'span'
  name: string
  endTs?: number
  durMs: number | null
  children: LogNode[]
}

/** Точечное событие */
export interface EventNode extends BaseNode {
  kind: 'event'
  msg: string
  data?: unknown
  err?: unknown
}

export type LogNode = SpanNode | EventNode
