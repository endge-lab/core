export type VocabReference = string | number

export type VocabCacheOperationStatus
  = 'cache-hit'
    | 'loaded'
    | 'refreshed'
    | 'invalidated'

export interface VocabCacheOperationResult {
  identity: string
  status: VocabCacheOperationStatus
  count: number
}

