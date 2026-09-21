import type { DataViewRef } from '@/features/core/modules/source/domain/types/data-view-source.types'

/** Упорядоченный transform response-output, общий для Query и Vocab. */
export type ResponseOutputTransform
  = | {
    kind: 'data-view'
    ref: DataViewRef
  }
  | {
    kind: 'converter'
    identity: string
    options?: Record<string, unknown>
  }
