import type { ComputationRuntimeErrorShape } from '@/features/core/modules/domain/types/computation/computation-runtime.types'
import type { RuntimeHostInputSource } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { FilterViewRenderModel } from '@/features/core/modules/source/domain/types/filter-view.type'
import type { EndgeStyleSheetArtifact } from '@/features/core/modules/styles/domain/types/style.types'

/** Готовое состояние вычисления клиента; observer не исполняет computation повторно. */
export interface RuntimeComputationInspection {
  identity: string
  input: unknown
  status: 'idle' | 'pending' | 'success' | 'error'
  loading: boolean
  value: unknown
  error: ComputationRuntimeErrorShape | null
}

export type RuntimeRenderableInspection
  = | {
    kind: 'component-sfc'
    input: RuntimeHostInputSource | null
    computations: RuntimeComputationInspection[]
    dataMeta: Record<string, unknown>
  }
  | { kind: 'filter-view', model: FilterViewRenderModel }

/** Дополнение к данным Raph: фактические привязки и presentation state экземпляров. */
export interface RuntimeRenderInspection {
  hosts: Record<string, RuntimeRenderableInspection>
  styles: readonly EndgeStyleSheetArtifact[]
}
