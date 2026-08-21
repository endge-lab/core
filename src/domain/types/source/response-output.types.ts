import type { DataViewRef } from '@/domain/types/source/data-view-source.types'

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

