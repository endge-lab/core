export type VocabReference = string | number

export type VocabLoadStrategy
  = 'cache-first'
    | 'network-first'
    | 'stale-while-revalidate'

export type VocabLoadErrorPolicy
  = 'fail'
    | 'use-cache'

export interface VocabLoadPolicy {
  strategy: VocabLoadStrategy
  /**
   * Максимальный возраст cache entry в миллисекундах.
   * `null` означает, что cache не устаревает автоматически.
   */
  maxAgeMs: number | null
  onError: VocabLoadErrorPolicy
}

export const DEFAULT_VOCAB_LOAD_POLICY: Readonly<VocabLoadPolicy> = Object.freeze({
  strategy: 'cache-first',
  maxAgeMs: null,
  onError: 'fail',
})

export type VocabCacheOperationStatus
  = 'cache-hit'
    | 'loaded'
    | 'refreshed'
    | 'refreshing'
    | 'invalidated'

export interface VocabCacheOperationResult {
  identity: string
  status: VocabCacheOperationStatus
  count: number
}
