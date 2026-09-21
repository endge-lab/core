import type { RuntimeHostStatus } from './runtime-host.types'
import type { RuntimeRenderInspection } from './runtime-render-inspection.types'
import type { EndgeRuntimeSnapshot } from './runtime.types'

/** Наблюдаемое состояние Runtime. Данные никогда не исполняются при импорте. */
export interface RuntimeInspectionSnapshot {
  version: 1
  runtime: EndgeRuntimeSnapshot
  data?: unknown
  render?: RuntimeRenderInspection
  dataGeneratedAt?: number
  dataError?: string
}

/** Клиентский идентификатор экземпляра и его поколение защищают от повторного использования id. */
export type RuntimeControlTarget
  = | { kind: 'host', id: string, createdAt: number }
    | { kind: 'scope', id: string, generation: number }

export type RuntimeControlOperation = 'pause' | 'resume' | 'stop'
export interface RuntimeStatusChange {
  readonly id: string
  readonly previous: RuntimeHostStatus
  readonly value: RuntimeHostStatus
}
