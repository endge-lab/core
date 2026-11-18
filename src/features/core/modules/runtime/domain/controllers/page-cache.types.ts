export interface PageCacheOptions {
  key: string
  storage: 'memory' | 'indexeddb'
  strategy?: 'cache-first' | 'network-first' | 'stale-while-revalidate'
  maxAgeMs?: number
  maxStaleMs?: number
  onError?: 'fail' | 'use-cache'
  maxEntries?: number
  maxBytes?: number
}

export interface PageCacheEntry {
  version: 1
  value: unknown
  storedAt: number
  bytes: number
  epoch: number
}

export interface PageCacheStatus {
  source: 'memory' | 'indexeddb' | 'network' | null
  stale: boolean
  revalidating: boolean
  hits: number
  misses: number
  evictions: number
  entries: number
  bytes: number
  pendingWrites: number
  pendingBytes: number
  error: string | null
  invalidated: boolean
}

export interface ControllerPageCache {
  readonly options: Required<PageCacheOptions>
  // Selection and page keys are opaque hashes; no credentials are persisted.
  select: (selection: Record<string, unknown>) => Promise<void>
  read: (request: Record<string, unknown>) => Promise<PageCacheEntry | undefined>
  write: (request: Record<string, unknown>, value: unknown, requestedAt?: number) => Promise<void>
  clear: (structuralChange?: boolean) => Promise<void>
  status: () => PageCacheStatus
  subscribe: (listener: () => void) => () => void
}

export function normalizePageCacheOptions(value: unknown): Required<PageCacheOptions> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('window-cache-options-invalid')
  }
  const input = value as Record<string, unknown>
  const allowed = ['key', 'storage', 'strategy', 'maxAgeMs', 'maxStaleMs', 'onError', 'maxEntries', 'maxBytes']
  if (Object.keys(input).some(key => !allowed.includes(key)) || typeof input.key !== 'string' || !input.key.trim() || !['memory', 'indexeddb'].includes(String(input.storage))) {
    throw new TypeError('window-cache-options-invalid')
  }
  const options = { strategy: 'cache-first', maxAgeMs: 60000, maxStaleMs: 0, onError: 'fail', maxEntries: 500, maxBytes: 50 * 1024 * 1024, ...input } as Required<PageCacheOptions>
  if (!['cache-first', 'network-first', 'stale-while-revalidate'].includes(options.strategy) || !['fail', 'use-cache'].includes(options.onError)) {
    throw new TypeError('window-cache-policy-invalid')
  }
  for (const key of ['maxAgeMs', 'maxStaleMs', 'maxEntries', 'maxBytes'] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < (key === 'maxEntries' || key === 'maxBytes' ? 1 : 0)) {
      throw new TypeError(`window-cache-${key}-invalid`)
    }
  }
  return options
}
