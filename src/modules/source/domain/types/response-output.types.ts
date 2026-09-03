import type { DataViewRef } from '@/modules/source/domain/types/data-view-source.types'

/** Ordered response-output transform shared by Query and Vocab. */
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
