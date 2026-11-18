import type { IDBPDatabase } from 'idb'
import type { ControllerPageCache, PageCacheEntry, PageCacheOptions, PageCacheStatus } from '../../../domain/controllers/page-cache.types'
import { openDB } from 'idb'
import { normalizePageCacheOptions } from '../../../domain/controllers/page-cache.types'

interface RecordMeta {
  key: string
  namespace: string
  selection: string
  access: number
  storedAt: number
  requestedAt: number
  bytes: number
  epoch: number
  version: 1
}
interface Bucket {
  entries: Map<string, { meta: RecordMeta, value: unknown }>
  epochs: Map<string, number>
  structural: Map<string, number>
  options: Required<PageCacheOptions>
  count: number
  bytes: number
  evictions: number
  listeners: Set<() => void>
}
interface PendingWrite {
  meta: RecordMeta
  value: unknown
  bucket: Bucket
}
interface PreparingWrite {
  selection: string
  request: string
  bytes: number
  done: Promise<void>
  finish: () => void
}

export const PAGE_CACHE_DATABASE = 'endge-collection-pages'

// Canonical JSON for keys only. Undefined request properties are omitted just as in JSON transport.
export function pageCacheJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    }
    return item
  })
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(pageCacheJson(value))
  const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Runtime-owned bounded page cache. It never owns a Query or writes Store data. */
export class PageCacheService {
  private readonly _buckets = new Map<string, Bucket>()
  private readonly _queue = new Map<string, PendingWrite>()
  private _queuedBytes = 0
  private _database: Promise<IDBPDatabase> | null = null
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _flushing: Promise<void> | null = null
  private _activeWrite: PendingWrite | null = null
  private readonly _preparing = new Map<symbol, PreparingWrite>()
  private _preparingBytes = 0
  private _generation = 0
  private _lastError: string | null = null

  public create(input: PageCacheOptions, scope: () => unknown): ControllerPageCache {
    const options = Object.freeze(normalizePageCacheOptions(input))
    let namespace = ''
    let selection = ''
    let epoch = 0
    let bucket: Bucket | undefined
    let selectedIdentity = ''
    let selectionSequence = 0
    let selectedScope = ''
    let observedStructure = 0
    let invalidated = false
    let disabled = false
    const listeners = new Set<() => void>()
    const notify = () => listeners.forEach(listener => listener())
    const counters = { hits: 0, misses: 0, evictions: 0 }
    const current = () => {
      if (!bucket || !selection) {
        throw new Error('window-cache-selection-required')
      }
      return bucket
    }
    const status = (): PageCacheStatus => ({
      source: null,
      stale: false,
      revalidating: false,
      ...counters,
      evictions: bucket?.evictions ?? 0,
      entries: bucket?.count ?? 0,
      bytes: bucket?.bytes ?? 0,
      pendingWrites: this._queue.size + this._preparing.size + (this._activeWrite ? 1 : 0),
      pendingBytes: this._queuedBytes + this._preparingBytes + (this._activeWrite?.meta.bytes ?? 0),
      error: this._lastError,
      invalidated: invalidated || (bucket?.structural.get(selection) ?? 0) > observedStructure,
    })
    return {
      options,
      select: async (value) => {
        if (!globalThis.crypto?.subtle) {
          disabled = true
          this._lastError = 'window-cache-crypto-unavailable'
          return
        }
        const currentScope = scope()
        const identity = pageCacheJson([currentScope, options.key, options.storage, value])
        if (identity === selectedIdentity) {
          epoch = bucket?.epochs.get(selection) ?? epoch
          invalidated ||= (bucket?.structural.get(selection) ?? 0) > observedStructure
          return
        }
        const sequence = ++selectionSequence
        const serviceGeneration = this._generation
        const nextNamespace = await digest([currentScope, options.key, options.storage])
        const nextSelection = await digest([nextNamespace, value])
        if (serviceGeneration !== this._generation) {
          return
        }
        let nextBucket = this._buckets.get(nextNamespace)
        if (!nextBucket) {
          nextBucket = { entries: new Map(), epochs: new Map(), structural: new Map(), options, count: 0, bytes: 0, evictions: 0, listeners: new Set() }
          this._buckets.set(nextNamespace, nextBucket)
        }
        if (nextBucket.options.maxEntries !== options.maxEntries || nextBucket.options.maxBytes !== options.maxBytes) {
          throw new Error('window-cache-budget-conflict')
        }
        let nextEpoch = nextBucket.epochs.get(nextSelection) ?? 0
        if (options.storage === 'indexeddb') {
          try {
            const db = await this._open()
            const values = await Promise.all([db.get('meta', `epoch:${nextSelection}`), db.get('meta', `stats:${nextNamespace}`), db.get('meta', `structure:${nextSelection}`)])
            nextEpoch = values[0] ?? 0
            nextBucket.epochs.set(nextSelection, nextEpoch)
            nextBucket.count = values[1]?.count ?? 0
            nextBucket.bytes = values[1]?.bytes ?? 0
            nextBucket.structural.set(nextSelection, values[2] ?? 0)
          }
          catch { this._lastError = 'window-cache-storage-unavailable' }
        }
        if (sequence !== selectionSequence) {
          return
        }
        bucket?.listeners.delete(notify)
        namespace = nextNamespace
        selection = nextSelection
        bucket = nextBucket
        epoch = nextEpoch
        if (listeners.size) {
          bucket.listeners.add(notify)
        }
        selectedIdentity = identity
        selectedScope = pageCacheJson(currentScope)
        observedStructure = nextBucket.structural.get(nextSelection) ?? 0
        invalidated = false
      },
      read: async (request) => {
        if (disabled) {
          return undefined
        }
        const owned = current()
        if (pageCacheJson(scope()) !== selectedScope) {
          return undefined
        }
        const selected = selection
        const expected = epoch
        const generation = this._generation
        const requestIdentity = pageCacheJson(request)
        await Promise.all([...this._preparing.values()].filter(item => item.selection === selected && item.request === requestIdentity).map(item => item.done))
        const key = `${selected}:${await digest(request)}`
        if (generation !== this._generation || selected !== selection) {
          return undefined
        }
        let entry: PageCacheEntry | undefined
        if (options.storage === 'memory') {
          const found = owned.entries.get(key)
          if (found && found.meta.epoch === (owned.epochs.get(selected) ?? 0)) {
            owned.entries.delete(key)
            owned.entries.set(key, found)
            entry = { ...found.meta, value: structuredClone(found.value) }
          }
        }
        else {
          let transaction: { abort: () => void, done: Promise<void> } | undefined
          try {
            const db = await this._open()
            const tx = db.transaction(['entries', 'pages', 'meta'], 'readwrite')
            transaction = tx
            const [meta, value, actualEpoch, structure] = await Promise.all([tx.objectStore('entries').get(key), tx.objectStore('pages').get(key), tx.objectStore('meta').get(`epoch:${selected}`), tx.objectStore('meta').get(`structure:${selected}`)])
            epoch = actualEpoch ?? 0
            owned.epochs.set(selected, epoch)
            owned.structural.set(selected, structure ?? 0)
            invalidated ||= (structure ?? 0) > observedStructure
            const queued = this._queue.get(key) ?? (this._activeWrite?.meta.key === key ? this._activeWrite : undefined)
            if (queued && queued.meta.epoch === epoch) {
              entry = {
                ...queued.meta,
                value: structuredClone(queued.value),
              }
            }
            if (meta?.version === 1 && meta.epoch === (actualEpoch ?? 0) && value !== undefined && Number.isFinite(meta.storedAt) && Number.isSafeInteger(meta.bytes) && meta.bytes >= 0) {
              entry ??= { ...meta, value }
              const stats = await tx.objectStore('meta').get(`stats:${namespace}`) ?? { count: 0, bytes: 0 }
              stats.access = Math.max(Date.now(), (stats.access ?? 0) + 1, meta.access + 1)
              await tx.objectStore('entries').put({ ...meta, access: stats.access })
              await tx.objectStore('meta').put(stats, `stats:${namespace}`)
            }
            await tx.done
          }
          catch {
            await this._rollback(transaction)
            this._lastError = 'window-cache-storage-read-failed'
          }
        }
        if (invalidated || generation !== this._generation || selected !== selection || expected !== (owned.epochs.get(selected) ?? 0)) {
          return undefined
        }
        if (entry) {
          counters.hits++
        }
        else { counters.misses++ }
        return entry
      },
      write: async (request, value, requestedAt = Date.now()) => {
        if (disabled) {
          return
        }
        const owned = current()
        if (pageCacheJson(scope()) !== selectedScope) {
          return
        }
        const selected = selection
        const expected = epoch
        const generation = this._generation
        const token = Symbol('page-write')
        try {
          const visited = new Set<object>()
          const validate = (item: unknown): void => {
            if (item === null || typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) {
              return
            }
            if (typeof item !== 'object' || visited.has(item) || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)) {
              throw new Error('unsupported')
            }
            visited.add(item)
            for (const child of Object.values(item)) {
              validate(child)
            }
            visited.delete(item)
          }
          validate(value)
          // Reject lossy JSON (functions, class instances, cycles) rather than changing row semantics.
          const serialized = JSON.stringify(value, (_key, item) => {
            if (item === undefined || typeof item === 'function' || typeof item === 'bigint' || (typeof item === 'number' && !Number.isFinite(item))) {
              throw new Error('unsupported')
            }
            if (item && typeof item === 'object' && !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) {
              throw new Error('unsupported')
            }
            return item
          })
          const bytes = new TextEncoder().encode(serialized).byteLength
          if (bytes > options.maxBytes) {
            this._lastError = 'window-cache-entry-too-large'
            return
          }
          if (options.storage === 'indexeddb') {
            if (this._queue.size + this._preparing.size + (this._activeWrite ? 1 : 0) >= 32 || this._queuedBytes + this._preparingBytes + bytes + (this._activeWrite?.meta.bytes ?? 0) > 8 * 1024 * 1024) {
              this._lastError = 'window-cache-write-queue-full'
              return
            }
            let finish!: () => void
            const done = new Promise<void>((resolve) => {
              finish = resolve
            })
            this._preparing.set(token, { selection: selected, request: pageCacheJson(request), bytes, done, finish })
            this._preparingBytes += bytes
          }
          const key = `${selected}:${await digest(request)}`
          if (generation !== this._generation || selected !== selection || expected !== (owned.epochs.get(selected) ?? 0)) {
            return
          }
          const meta: RecordMeta = { key, namespace, selection: selected, access: Date.now(), storedAt: Date.now(), requestedAt, bytes, epoch: expected, version: 1 }
          const copied = JSON.parse(serialized)
          if (options.storage === 'memory') {
            const previous = owned.entries.get(key)
            if ((previous?.meta.requestedAt ?? -Infinity) > requestedAt) {
              return
            }
            owned.bytes -= previous?.meta.bytes ?? 0
            owned.entries.delete(key)
            owned.entries.set(key, { meta, value: copied })
            owned.bytes += bytes
            while (owned.entries.size > options.maxEntries || owned.bytes > options.maxBytes) {
              const oldest = owned.entries.keys().next().value!
              owned.bytes -= owned.entries.get(oldest)!.meta.bytes
              owned.entries.delete(oldest)
              counters.evictions++
              owned.evictions++
            }
            owned.count = owned.entries.size
            owned.listeners.forEach(listener => listener())
          }
          else {
            this._finishPreparation(token)
            const previous = this._queue.get(key)
            if ((previous?.meta.requestedAt ?? -Infinity) > requestedAt) {
              return
            }
            const extra = bytes - (previous?.meta.bytes ?? 0)
            if ((!previous && this._queue.size + this._preparing.size + (this._activeWrite ? 1 : 0) >= 32) || this._queuedBytes + this._preparingBytes + extra + (this._activeWrite?.meta.bytes ?? 0) > 8 * 1024 * 1024) {
              this._lastError = 'window-cache-write-queue-full'
              return
            }
            this._queue.set(key, { meta, value: copied, bucket: owned })
            this._queuedBytes += extra
            this._schedule()
          }
        }
        catch { this._lastError = 'window-cache-value-not-serializable' }
        finally { this._finishPreparation(token) }
      },
      clear: async (structuralChange = false) => {
        if (disabled) {
          return
        }
        const owned = current()
        const selected = selection
        for (const [token, preparation] of this._preparing) {
          if (preparation.selection === selected) {
            this._finishPreparation(token)
          }
        }
        epoch = Math.max(epoch, owned.epochs.get(selected) ?? 0) + 1
        owned.epochs.set(selected, epoch)
        if (structuralChange) {
          owned.structural.set(selected, epoch)
        }
        observedStructure = owned.structural.get(selected) ?? 0
        invalidated = false
        for (const [key, item] of this._queue) {
          if (item.meta.selection === selected) {
            this._queue.delete(key)
            this._queuedBytes -= item.meta.bytes
          }
        }
        if (options.storage === 'memory') {
          for (const [key, item] of owned.entries) {
            if (item.meta.selection === selected) {
              owned.entries.delete(key)
              owned.bytes -= item.meta.bytes
            }
          }
          owned.count = owned.entries.size
          owned.listeners.forEach(listener => listener())
        }
        else {
          let transaction: { abort: () => void, done: Promise<void> } | undefined
          try {
            const db = await this._open()
            const tx = db.transaction(['entries', 'pages', 'meta'], 'readwrite')
            transaction = tx
            epoch = (await tx.objectStore('meta').get(`epoch:${selected}`) ?? 0) + 1
            owned.epochs.set(selected, epoch)
            await tx.objectStore('meta').put(epoch, `epoch:${selected}`)
            if (structuralChange) {
              await tx.objectStore('meta').put(epoch, `structure:${selected}`)
              owned.structural.set(selected, epoch)
              observedStructure = epoch
            }
            const stats = await tx.objectStore('meta').get(`stats:${namespace}`) ?? { count: 0, bytes: 0 }
            let cursor = await tx.objectStore('entries').index('selection').openCursor(selected)
            while (cursor) {
              stats.count--
              stats.bytes -= cursor.value.bytes
              await tx.objectStore('pages').delete(cursor.value.key)
              await cursor.delete()
              cursor = await cursor.continue()
            }
            await tx.objectStore('meta').put(stats, `stats:${namespace}`)
            await tx.done
            owned.count = stats.count
            owned.bytes = stats.bytes
            owned.listeners.forEach(listener => listener())
          }
          catch {
            await this._rollback(transaction)
            this._lastError = 'window-cache-storage-clear-failed'
          }
        }
      },
      status,
      subscribe: (listener) => {
        listeners.add(listener)
        bucket?.listeners.add(notify)
        return () => {
          listeners.delete(listener)
          if (!listeners.size) {
            bucket?.listeners.delete(notify)
          }
        }
      },
    }
  }

  public async flush(): Promise<void> {
    if (this._flushing) {
      await this._flushing
      if (this._queue.size) {
        await this.flush()
      };
      return
    }
    this._flushing = this._flush()
    try {
      await this._flushing
    }
    finally { this._flushing = null }
  }

  public async reset(): Promise<void> {
    this._generation++
    if (this._timer !== null) {
      clearTimeout(this._timer)
      this._timer = null
    }
    this._queue.clear()
    for (const token of this._preparing.keys()) {
      this._finishPreparation(token)
    }
    this._queuedBytes = 0
    await this._flushing
    if (this._database) {
      try {
        (await this._database).close()
      }
      catch {}
    }
    this._database = null
    this._buckets.clear()
    this._lastError = null
  }

  private _schedule(): void {
    if (this._timer !== null) {
      return
    }
    this._timer = setTimeout(() => {
      this._timer = null
      void this.flush()
    }, 0)
  }

  private _finishPreparation(token: symbol): void {
    const preparation = this._preparing.get(token)
    if (!preparation) {
      return
    }
    this._preparing.delete(token)
    this._preparingBytes -= preparation.bytes
    preparation.finish()
  }

  private async _open(): Promise<IDBPDatabase> {
    if (typeof indexedDB === 'undefined') {
      throw new Error('indexeddb-unavailable')
    }
    this._database ??= openDB(PAGE_CACHE_DATABASE, 1, {
      upgrade(db) {
        const entries = db.createObjectStore('entries', { keyPath: 'key' })
        entries.createIndex('selection', 'selection')
        entries.createIndex('lru', ['namespace', 'access', 'key'])
        db.createObjectStore('pages')
        db.createObjectStore('meta')
      },
      blocking: () => {
        void this._database?.then(db => db.close())
        this._database = null
      },
      terminated: () => { this._database = null },
    })
    return this._database
  }

  private async _flush(): Promise<void> {
    const generation = this._generation
    while (this._queue.size && generation === this._generation) {
      const [key, pending] = this._queue.entries().next().value!
      this._queue.delete(key)
      this._queuedBytes -= pending.meta.bytes
      this._activeWrite = pending
      let transaction: { abort: () => void, done: Promise<void> } | undefined
      try {
        const db = await this._open()
        const tx = db.transaction(['entries', 'pages', 'meta'], 'readwrite')
        transaction = tx
        const { meta, bucket } = pending
        const actualEpoch = await tx.objectStore('meta').get(`epoch:${meta.selection}`) ?? 0
        if (actualEpoch !== meta.epoch || generation !== this._generation || (bucket.epochs.get(meta.selection) ?? 0) !== meta.epoch) {
          await tx.done
          continue
        }
        const stats = await tx.objectStore('meta').get(`stats:${meta.namespace}`) ?? { count: 0, bytes: 0 }
        const previous = await tx.objectStore('entries').get(key)
        if ((previous?.requestedAt ?? -Infinity) > meta.requestedAt) {
          await tx.done
          continue
        }
        stats.count += previous ? 0 : 1
        stats.bytes += meta.bytes - (previous?.bytes ?? 0)
        stats.access = Math.max(Date.now(), (stats.access ?? 0) + 1)
        meta.access = stats.access
        await tx.objectStore('entries').put(meta)
        await tx.objectStore('pages').put(pending.value, key)
        const range = IDBKeyRange.bound([meta.namespace, 0, ''], [meta.namespace, Number.MAX_SAFE_INTEGER, '\uFFFF'])
        let cursor = await tx.objectStore('entries').index('lru').openCursor(range)
        while (cursor && (stats.count > bucket.options.maxEntries || stats.bytes > bucket.options.maxBytes)) {
          stats.count--
          stats.bytes -= cursor.value.bytes
          bucket.evictions++
          await tx.objectStore('pages').delete(cursor.value.key)
          await cursor.delete()
          cursor = await cursor.continue()
        }
        await tx.objectStore('meta').put(stats, `stats:${meta.namespace}`)
        await tx.done
        bucket.count = stats.count
        bucket.bytes = stats.bytes
      }
      catch {
        await this._rollback(transaction)
        this._lastError = 'window-cache-storage-write-failed'
      }
      finally {
        this._activeWrite = null
        pending.bucket.listeners.forEach(listener => listener())
      }
    }
  }

  private async _rollback(transaction?: { abort: () => void, done: Promise<void> }): Promise<void> {
    if (!transaction) {
      return
    }
    try {
      transaction.abort()
    }
    catch { /* A failed request may already have aborted its transaction. */ }
    await transaction.done.catch(() => {})
  }
}
