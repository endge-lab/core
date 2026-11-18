import type { CollectionWindowState, ControllerContext } from '@/features/core/modules/runtime/domain/controllers/controller.types'
import type { PageCacheOptions } from '@/features/core/modules/runtime/domain/controllers/page-cache.types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizePageCacheOptions } from '@/features/core/modules/runtime/domain/controllers/page-cache.types'
import { CollectionWindowController } from '@/features/core/modules/runtime/services/controllers/builtins/CollectionWindowController'
import { PageCacheService } from '@/features/core/modules/runtime/services/controllers/cache/PageCacheService'

afterEach(() => vi.restoreAllMocks())
async function settle() {
  for (let i = 0;
    i < 15;
    i++) {
    await new Promise(resolve => setTimeout(resolve, 0))
  }
}
function page(offset: number, count = 100, total = 1000, label = 'row') {
  return { offset, total, rows: Array.from({ length: count }, (_, i) => ({ id: offset + i, label: `${label}-${offset + i}` })), hasBefore: offset > 0, hasAfter: offset + count < total }
}
function fixture(options: { cache?: PageCacheOptions, service?: PageCacheService, props?: Record<string, unknown>, run?: (request: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> } = {}) {
  let state: CollectionWindowState = { revision: 0, rowsRevision: 0, blocks: [] }
  let outputs: Record<string, any> = {}
  const listeners = new Set<() => void>()
  const run = vi.fn(options.run ?? (async request => page(Number(request.offset))))
  const context: ControllerContext = {
    props: { paging: 'offset', rowKey: 'id', batchSize: 100, prefetchRows: 20, maxLoadedRows: 1000, initialOffset: 0, autoLoad: false, request: {}, ...options.props },
    signal: new AbortController().signal,
    dependencies: {
      state: {
        kind: 'store',
        read: () => structuredClone(state),
        commit: (next, expected) => {
          if (expected !== state.revision) {
            throw new Error('CAS failed')
          }
          state = structuredClone(next) as CollectionWindowState
          listeners.forEach(listener => listener())
        },
        subscribe: (listener) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      },
      load: { kind: 'query', run, ...(options.cache ? { cache: (options.service ?? new PageCacheService()).create(options.cache, () => ({ user: 'test', workspace: 'fixture' })) } : {}) },
    },
    publish: (value) => { outputs = { ...outputs, ...value } },
  }
  const controller = new CollectionWindowController(context)
  controller.start(context)
  return {
    controller,
    context,
    run,
    state: () => state,
    outputs: () => outputs,
    command: (name: string, input?: unknown) => controller.command(name, input, context),
    viewport: (first: number, last: number) => controller.command('setViewport', { rowsRevision: state.rowsRevision, firstVisible: { key: state.blocks.flatMap(b => b.rows)[first]!.id, index: first }, lastVisible: { key: state.blocks.flatMap(b => b.rows)[last]!.id, index: last }, rowCount: state.blocks.flatMap(b => b.rows).length }, context),
  }
}

describe('page cache contract', () => {
  it.each([{ key: '', storage: 'memory' }, { key: 'a', storage: 'disk' }, { key: 'a', storage: 'memory', maxAgeMs: -1 }, { key: 'a', storage: 'memory', maxEntries: 0 }, { key: 'a', storage: 'memory', typo: true }])('rejects invalid options %j', (value) => {
    expect(() => normalizePageCacheOptions(value)).toThrow()
  })
  it('returns independent values and shares completed pages within the same scope', async () => {
    const service = new PageCacheService()
    const cache = service.create({ key: 'pages', storage: 'memory' }, () => 'user-a')
    await cache.select({ filter: 'a' })
    const original = page(0)
    await cache.write({ offset: 0 }, original)
    original.rows[0]!.label = 'changed'
    const first = await cache.read({ offset: 0 })
    expect((first!.value as ReturnType<typeof page>).rows[0]!.label).toBe('row-0')
    ;(first!.value as ReturnType<typeof page>).rows[0]!.label = 'changed-again'
    const second = service.create({ key: 'pages', storage: 'memory' }, () => 'user-a')
    await second.select({ filter: 'a' })
    expect((await second.read({ offset: 0 }))!.value).toEqual(page(0))
    await service.reset()
  })
  it('isolates user, selection, output fingerprint and live/mock mode', async () => {
    const service = new PageCacheService()
    const a = service.create({ key: 'p', storage: 'memory' }, () => ({ user: 'a', output: 'one', mode: 'live' }))
    await a.select({
      filter: 'a',
    })
    await a.write({
      offset: 0,
    }, page(0))
    for (const scope of [{ user: 'b', output: 'one', mode: 'live' }, { user: 'a', output: 'two', mode: 'live' }, { user: 'a', output: 'one', mode: 'mock' }]) {
      const other = service.create({ key: 'p', storage: 'memory' }, () => scope)
      await other.select({
        filter: 'a',
      })
      expect(await other.read({
        offset: 0,
      })).toBeUndefined()
    }
    await a.select({
      filter: 'b',
    })
    expect(await a.read({
      offset: 0,
    })).toBeUndefined()
    await service.reset()
  })
  it('evicts LRU across selections and respects byte and entry limits', async () => {
    const service = new PageCacheService()
    const cache = service.create({ key: 'p', storage: 'memory', maxEntries: 2, maxBytes: 500 }, () => 'user')
    await cache.select({
    })
    await cache.write({
      offset: 0,
    }, {
      value: 'a',
    })
    await cache.write({
      offset: 1,
    }, {
      value: 'b',
    })
    await cache.read({
      offset: 0,
    })
    await cache.write({
      offset: 2,
    }, {
      value: 'c',
    })
    expect(await cache.read({ offset: 1 })).toBeUndefined()
    expect(await cache.read({ offset: 0 })).toBeDefined()
    await cache.write({ offset: 3 }, { value: 'x'.repeat(480) })
    expect(cache.status().bytes).toBeLessThanOrEqual(500)
    expect(cache.status().entries).toBeLessThanOrEqual(2)
    await service.reset()
  })
  it('clear fences an already started asynchronous write', async () => {
    const service = new PageCacheService()
    const cache = service.create({ key: 'p', storage: 'memory' }, () => 'user')
    await cache.select({})
    const pending = cache.write({ offset: 0 }, page(0))
    await cache.clear()
    await pending
    expect(await cache.read({ offset: 0 })).toBeUndefined()
    await service.reset()
  })
  it('scope changes prevent reads and writes before selecting the new scope', async () => {
    let user = 'a'
    const service = new PageCacheService()
    const cache = service.create({ key: 'p', storage: 'memory' }, () => user)
    await cache.select({
    })
    await cache.write({
    }, page(0))
    user = 'b'
    expect(await cache.read({})).toBeUndefined()
    await cache.write({
    }, page(100))
    await cache.select({
    })
    expect(await cache.read({})).toBeUndefined()
    await service.reset()
  })
  it('unavailable IndexedDB is diagnostic and does not reject the operation', async () => {
    const service = new PageCacheService()
    const cache = service.create({ key: 'p', storage: 'indexeddb' }, () => 'user')
    await cache.select({
    })
    expect(await cache.read({
    })).toBeUndefined()
    expect(cache.status().error).toContain('window-cache-storage')
    await service.reset()
  })
})

describe('collection window retention and revalidation', () => {
  it('drops distant whole blocks below the total cap and preserves a pinned continuous span', async () => {
    const f = fixture({ props: { prefetchRows: 0, retention: { beforeRows: 0, afterRows: 0 } } })
    await f.command('loadInitial')
    await f.command('loadAfter')
    await f.command('loadAfter')
    await f.command('retainRows', [0])
    await f.viewport(220, 229)
    expect(f.outputs().loadedRowCount).toBe(300)
    await f.command('releaseRows', [0])
    expect(f.outputs().rows[0].id).toBe(200)
    expect(f.outputs().loadedRowCount).toBe(100)
    f.controller.destroy()
  })
  it('rejects retention smaller than the protected prefetch corridor', () => {
    expect(() => fixture({ props: { retention: { beforeRows: 1, afterRows: 20 } } })).toThrow('window-retention-invalid')
  })
  it('rejects a short response whose source edge was removed while loading', async () => {
    let resolve!: (value: unknown) => void
    const f = fixture({
      props: {
        prefetchRows: 50,
        maxLoadedRows: 150,
      },
      run: async request => Number(request.offset) === 200
        ? new Promise((done) => {
            resolve = done
          })
        : page(Number(request.offset), 100, 230),
    })
    await f.command('loadInitial')
    await f.command('loadAfter')
    const pending = f.viewport(145, 154)
    await settle()
    await f.viewport(0, 9)
    expect(f.outputs().rows.at(-1).id).toBe(99)
    resolve(page(200, 30, 230))
    await pending
    expect(f.outputs().rows.map((row: { id: number }) => row.id)).toEqual(Array.from({ length: 100 }, (_, i) => i))
    f.controller.destroy()
  })
  it.each(['cache-first', 'network-first', 'stale-while-revalidate'] as const)('implements %s with fresh cache', async (strategy) => {
    const service = new PageCacheService()
    const options = { key: 'p', storage: 'memory' as const, strategy }
    const first = fixture({
      cache: options,
      service,
    })
    await first.command('loadInitial')
    await settle()
    first.controller.destroy()
    const second = fixture({
      cache: options,
      service,
    })
    await second.command('loadInitial')
    expect(second.run).toHaveBeenCalledTimes(strategy === 'network-first' ? 1 : 0)
    second.controller.destroy()
    await service.reset()
  })
  it('sWR changes values without moving keys; structural changes freeze until refresh', async () => {
    const service = new PageCacheService()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    let current = page(0, 100, 1000, 'old')
    const f = fixture({ cache: { key: 'p', storage: 'memory', strategy: 'stale-while-revalidate', maxAgeMs: 10, maxStaleMs: 1000 }, service, run: async () => current })
    await f.command('loadInitial')
    await settle()
    clock.mockReturnValue(1020)
    current = page(0, 100, 1000, 'new')
    await f.viewport(20, 29)
    await settle()
    expect(f.outputs().rows[20].label).toBe('new-20')
    expect(f.outputs().refreshPending).toBe(false)
    clock.mockReturnValue(1040)
    current = page(0, 99, 1000, 'changed')
    await f.viewport(21, 30)
    await settle()
    expect(f.outputs().refreshPending).toBe(true)
    expect(f.outputs().rows[20].label).toBe('new-20')
    const requests = f.run.mock.calls.length
    await f.command('loadAfter')
    expect(f.run.mock.calls.length).toBe(requests)
    await f.command('refresh')
    expect(f.outputs().refreshPending).toBe(false)
    expect(f.outputs().rows.length).toBe(99)
    f.controller.destroy()
    await service.reset()
  })
  it('clearCache preserves rows and forces the next initial load to reach Query', async () => {
    const service = new PageCacheService()
    const f = fixture({ cache: { key: 'p', storage: 'memory' }, service })
    await f.command('loadInitial')
    await settle()
    await f.command('clearCache')
    expect(f.outputs().loadedRowCount).toBe(100)
    await f.command('loadInitial')
    expect(f.run).toHaveBeenCalledTimes(2)
    f.controller.destroy()
    await service.reset()
  })
})

describe('cache expiry, fallback and operation ownership', () => {
  it.each(['cache-first', 'network-first', 'stale-while-revalidate'] as const)('loads expired %s pages according to policy', async (strategy) => {
    const service = new PageCacheService()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const options = { key: 'expiry', storage: 'memory' as const, strategy, maxAgeMs: 10, maxStaleMs: 100 }
    const first = fixture({
      service,
      cache: options,
    })
    await first.command('loadInitial')
    await settle()
    first.controller.destroy()
    clock.mockReturnValue(1020)
    const next = fixture({ service, cache: options, run: async () => page(0, 100, 1000, 'updated') })
    await next.command('loadInitial')
    await settle()
    expect(next.run).toHaveBeenCalledTimes(1)
    expect(next.outputs().rows[0].label).toBe('updated-0')
    next.controller.destroy()
    await service.reset()
  })
  it.each([true, false])('network failure uses bounded stale data only when explicitly enabled: %s', async (allowed) => {
    const service = new PageCacheService()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const options = { key: 'fallback', storage: 'memory' as const, strategy: 'network-first' as const, maxAgeMs: 10, maxStaleMs: 100, onError: allowed ? 'use-cache' as const : 'fail' as const }
    const first = fixture({
      service,
      cache: options,
    })
    await first.command('loadInitial')
    await settle()
    first.controller.destroy()
    clock.mockReturnValue(1020)
    const next = fixture({
      service,
      cache: options,
      run: async () => {
        throw new Error('offline')
      },
    })
    await next.command('loadInitial')
    expect(next.outputs().loadedRowCount).toBe(allowed ? 100 : 0)
    expect(Boolean(next.outputs().error)).toBe(!allowed)
    next.controller.destroy()
    await service.reset()
  })
  it.each([401, 403, 503])('never substitutes expired or unauthorized responses (%s)', async (status) => {
    const service = new PageCacheService()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const options = { key: 'auth', storage: 'memory' as const, strategy: 'network-first' as const, maxAgeMs: 10, maxStaleMs: 100, onError: 'use-cache' as const }
    const first = fixture({
      service,
      cache: options,
    })
    await first.command('loadInitial')
    await settle()
    first.controller.destroy()
    clock.mockReturnValue(status === 503 ? 1200 : 1020)
    const next = fixture({
      service,
      cache: options,
      run: async () => {
        throw Object.assign(new Error('failed'), {
          response: {
            status,
          },
        })
      },
    })
    await next.command('loadInitial')
    expect(next.outputs().loadedRowCount).toBe(0)
    expect(next.outputs().error).toBeTruthy()
    next.controller.destroy()
    await service.reset()
  })
  it('does not cache invalid continuation responses', async () => {
    const service = new PageCacheService()
    const f = fixture({ service, cache: { key: 'invalid', storage: 'memory' }, run: async () => ({ rows: [], offset: 0, hasBefore: false, hasAfter: true }) })
    await f.command('loadInitial')
    await settle()
    expect(f.outputs().error.message).toBe('window-no-progress')
    expect(f.outputs().cacheStatus.entries).toBe(0)
    f.controller.destroy()
    await service.reset()
  })
  it('unchanged revalidation updates freshness without publishing a new row revision', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const service = new PageCacheService()
    const f = fixture({ service, cache: { key: 'same', storage: 'memory', strategy: 'stale-while-revalidate', maxAgeMs: 10, maxStaleMs: 100 } })
    await f.command('loadInitial')
    await settle()
    const revision = f.outputs().rowsRevision
    clock.mockReturnValue(1020)
    await f.viewport(20, 29)
    await settle()
    expect(f.outputs().rowsRevision).toBe(revision)
    expect(f.run).toHaveBeenCalledTimes(2)
    f.controller.destroy()
    await service.reset()
  })
  it('foreground aborts background transport before requesting another page', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const service = new PageCacheService()
    let backgroundSignal: AbortSignal | undefined
    let calls = 0
    const f = fixture({ service, cache: { key: 'priority', storage: 'memory', strategy: 'stale-while-revalidate', maxAgeMs: 10, maxStaleMs: 100 }, run: async (request, signal) => {
      calls++
      if (calls === 2) {
        backgroundSignal = signal
        return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }))
      }
      return page(Number(request.offset))
    } })
    await f.command('loadInitial')
    await settle()
    clock.mockReturnValue(1020)
    await f.viewport(20, 29)
    await settle()
    expect(backgroundSignal?.aborted).toBe(false)
    await f.command('loadAfter')
    expect(backgroundSignal?.aborted).toBe(true)
    expect(f.outputs().loadedRowCount).toBe(200)
    f.controller.destroy()
    await service.reset()
  })
  it('accepts a response after only the opposite edge was trimmed', async () => {
    let complete!: (value: unknown) => void
    const f = fixture({
      props: {
        maxLoadedRows: 200,
      },
      run: async request => Number(request.offset) === 300
        ? new Promise((resolve) => {
            complete = resolve
          })
        : page(Number(request.offset)),
    })
    await f.command('loadInitial')
    await f.command('loadAfter')
    await f.command('loadAfter')
    const pending = f.command('loadAfter')
    await settle()
    await f.viewport(285, 294)
    expect(f.outputs().rows[0].id).toBe(100)
    complete(page(300))
    await pending
    expect(f.outputs().rows.map((row: { id: number }) => row.id)).toEqual(Array.from({ length: 200 }, (_, i) => i + 200))
    f.controller.destroy()
  })
  it('shared cache structural invalidation freezes an existing second window', async () => {
    const service = new PageCacheService()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const options = { key: 'shared', storage: 'memory' as const, strategy: 'stale-while-revalidate' as const, maxAgeMs: 10, maxStaleMs: 100 }
    let changed = false
    const first = fixture({ service, cache: options, run: async () => ({ ...page(0), rows: page(changed ? 1 : 0).rows }) })
    await first.command('loadInitial')
    await settle()
    const second = fixture({
      service,
      cache: options,
    })
    await second.command('loadInitial')
    changed = true
    clock.mockReturnValue(1020)
    await first.viewport(20, 29)
    await settle()
    expect(first.outputs().refreshPending).toBe(true)
    await second.command('loadAfter')
    expect(second.outputs().refreshPending).toBe(true)
    expect(second.run).not.toHaveBeenCalled()
    first.controller.destroy()
    second.controller.destroy()
    await service.reset()
  })
})

describe('bounded writes and ordering', () => {
  it.each([1024, 300000])('bounds a blocked writer by page count and bytes (%s)', async (bytes) => {
    const service = new PageCacheService()
    vi.spyOn(service, 'flush').mockResolvedValue()
    const cache = service.create({ key: 'queue', storage: 'indexeddb' }, () => 'fixture')
    await cache.select({})
    for (let index = 0; index < 40; index++) {
      await cache.write({ offset: index }, { value: 'x'.repeat(bytes) })
    }
    expect(cache.status().pendingWrites).toBeLessThanOrEqual(32)
    expect(cache.status().pendingBytes).toBeLessThanOrEqual(8 * 1024 * 1024)
    expect(cache.status().error).toBe('window-cache-write-queue-full')
    await cache.clear()
    expect(cache.status().pendingWrites).toBe(0)
    await service.reset()
  })
  it('a later completion from an older request cannot overwrite a newer cached value', async () => {
    const service = new PageCacheService()
    const cache = service.create({ key: 'ordered', storage: 'memory' }, () => 'fixture')
    await cache.select({})
    await cache.write({ offset: 0 }, { value: 'new' }, 2000)
    await cache.write({ offset: 0 }, { value: 'old' }, 1000)
    expect((await cache.read({ offset: 0 }))?.value).toEqual({ value: 'new' })
    await service.reset()
  })
  it('lossy values are diagnostic rather than silently persisted', async () => {
    const service = new PageCacheService()
    const cache = service.create({ key: 'codec', storage: 'memory' }, () => 'fixture')
    await cache.select({})
    for (const value of [{ time: new Date() }, { method() {} }, { value: NaN }]) {
      await cache.write({}, value)
      expect(await cache.read({})).toBeUndefined()
      expect(cache.status().error).toBe('window-cache-value-not-serializable')
    }
    await service.reset()
  })
})

it('refresh of a shared selection fences another owner response already in flight', async () => {
  const service = new PageCacheService()
  const cache = { key: 'shared-refresh', storage: 'memory' as const }
  const first = fixture({ service, cache })
  await first.command('loadInitial')
  await settle()
  let complete!: (value: unknown) => void
  const second = fixture({
    service,
    cache,
    run: async () => new Promise((resolve) => {
      complete = resolve
    }),
  })
  await second.command('loadInitial')
  const pending = second.command('loadAfter')
  await settle()
  await first.command('refresh')
  complete(page(100))
  await pending
  expect(second.outputs().loadedRowCount).toBe(100)
  expect(second.outputs().refreshPending).toBe(true)
  first.controller.destroy()
  second.controller.destroy()
  await service.reset()
})

it('memory is readable immediately after an awaited load command', async () => {
  const service = new PageCacheService()
  const f = fixture({ service, cache: { key: 'immediate', storage: 'memory' } })
  await f.command('loadInitial')
  await f.command('reset')
  await f.command('loadInitial')
  expect(f.run).toHaveBeenCalledTimes(1)
  f.controller.destroy()
  await service.reset()
})
it('indexedDB diagnostics count asynchronous preparation before a write is queued', async () => {
  const service = new PageCacheService()
  const cache = service.create({ key: 'preparation', storage: 'indexeddb' }, () => 'fixture')
  await cache.select({})
  const pending = cache.write({ offset: 0 }, page(0))
  expect(cache.status().pendingWrites).toBe(1)
  await cache.clear()
  await pending
  expect(cache.status().pendingWrites).toBe(0)
  await service.reset()
})

it('notifies all memory namespace observers when another selection writes or clears', async () => {
  const service = new PageCacheService()
  const a = service.create({ key: 'observed', storage: 'memory' }, () => 'user')
  const b = service.create({ key: 'observed', storage: 'memory' }, () => 'user')
  await a.select({ filter: 'a' })
  await b.select({ filter: 'b' })
  const changed = vi.fn()
  const remove = a.subscribe(changed)
  await b.write({}, { value: 1 })
  expect(changed).toHaveBeenCalledTimes(1)
  expect(a.status().entries).toBe(1)
  await b.clear()
  expect(changed).toHaveBeenCalledTimes(2)
  expect(a.status().entries).toBe(0)
  remove()
  await service.reset()
})

it('rejects background values after a different owner invalidates the shared chain', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const service = new PageCacheService()
  const options = { key: 'shared-background', storage: 'memory' as const, strategy: 'stale-while-revalidate' as const, maxAgeMs: 10, maxStaleMs: 1000 }
  let complete!: (value: unknown) => void
  let background = false
  const first = fixture({
    service,
    cache: options,
    run: async () => background
      ? new Promise((resolve) => {
          complete = resolve
        })
      : page(0),
  })
  await first.command('loadInitial')
  const second = fixture({ service, cache: options })
  await second.command('loadInitial')
  const original = structuredClone(first.outputs().rows)
  background = true
  clock.mockReturnValue(1020)
  await first.viewport(20, 29)
  await settle()
  await second.command('refresh')
  complete({ ...page(0), rows: page(0).rows.map(row => ({ ...row, value: 'late' })) })
  await settle()
  expect(first.outputs().rows).toEqual(original)
  expect(first.outputs().refreshPending).toBe(true)
  first.controller.destroy()
  second.controller.destroy()
  await service.reset()
})
