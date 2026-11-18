import type { CollectionWindowBlock, CollectionWindowState, CollectionWindowViewport, ControllerContext, ControllerInstance, ControllerQueryDependency, ControllerStateDependency } from '../../../domain/controllers/controller.types'
import { pageCacheJson } from '../cache/PageCacheService'

type Direction = 'initial' | 'before' | 'after'

/** One instance owns demand and execution; all retained rows remain in Store. */
export class CollectionWindowController implements ControllerInstance {
  private _props: Record<string, unknown>
  private _state: ControllerStateDependency
  private _load: ControllerQueryDependency
  private _generation = 0
  private _active: AbortController | null = null
  private _activeDirection: Direction | null = null
  private _pending: Promise<void> | null = null
  private _viewport: CollectionWindowViewport | null = null
  private readonly _retained = new Set<string>()
  private _initialized = false
  private _paused = false
  private _disposed = false
  private _refreshPending = false
  private _pageSequence = 0
  private readonly _pages = new Map<string, { request: Record<string, unknown>, signature: string, storedAt: number, attempted: boolean }>()
  private _background: AbortController | null = null
  private _backgroundPage: string | null = null
  private _cacheSource: 'memory' | 'indexeddb' | 'network' | null = null
  private _cacheStale = false
  private _cacheError: string | null = null
  private _snapshot: CollectionWindowState | null = null
  private _publishedRowsRevision = -1
  private _cacheUnsubscribe: (() => void) | null = null
  private _error: {
    message: string
    direction: Direction
  } | null = null

  private _unsubscribe: (() => void) | null = null
  public constructor(private _context: ControllerContext) {
    this._props = {
      ..._context.props,
    }
    if (_context.dependencies.state?.kind !== 'store' || _context.dependencies.load?.kind !== 'query') {
      throw new Error('window-dependencies-required')
    }
    this._state = _context.dependencies.state
    this._load = _context.dependencies.load
    this._validateProps()
  }

  public start(context: ControllerContext): void {
    this._replaceContext(context)
    this._unsubscribe = this._state.subscribe(() => {
      this._snapshot = null
      this._publish()
    })
    this._cacheUnsubscribe = this._load.cache?.subscribe(() => this._publish()) ?? null
    this._publish()
    if (this._props.autoLoad !== false) {
      void this._request('initial')
    }
  }

  public async setProps(props: Readonly<Record<string, unknown>>, context: ControllerContext): Promise<void> {
    this._replaceContext(context)
    const previous = JSON.stringify([this._props.request, this._props.paging, this._props.rowKey, this._props.initialOffset])
    this._props = {
      ...props,
    }
    this._validateProps()
    if (previous !== JSON.stringify([props.request, props.paging, props.rowKey, props.initialOffset])) {
      await this._reset()
    }
    else {
      const interrupted = this._activeDirection
      if (interrupted) {
        this._cancel()
      }
      this._trim()
      this._publish()
      if (interrupted) {
        await this._request(interrupted)
      }
      else if (!this._initialized && this._props.autoLoad !== false) {
        await this._request('initial')
      }
    }
  }

  public async command(name: string, input: unknown, context: ControllerContext): Promise<void> {
    this._replaceContext(context)
    if (this._disposed || this._paused) {
      throw new DOMException('Controller is inactive.', 'AbortError')
    }
    switch (name) {
      case 'setViewport': {
        const viewport = input as CollectionWindowViewport
        const state = this._read()
        if (!viewport || viewport.rowsRevision !== state.rowsRevision) {
          return
        }
        this._viewport = viewport
        this._trim()
        await this._demand()
        this._revalidateVisible()
        return
      }
      case 'loadInitial':
        await this._request('initial')
        return
      case 'loadBefore':
        await this._request('before')
        return
      case 'loadAfter':
        await this._request('after')
        return
      case 'reset':
        await this._reset()
        return
      case 'refresh':
        this._cancel()
        await this._selectCache()
        await this._load.cache?.clear(true)
        await this._reset(true)
        return
      case 'clearCache':
        this._cancel()
        await this._selectCache()
        if (this._load.cache?.status().invalidated) {
          this._refreshPending = true
        }
        await this._load.cache?.clear()
        this._publish()
        return
      case 'retry': {
        const direction = this._error?.direction
        this._error = null
        if (direction) {
          await this._request(direction)
        }
        return
      }
      case 'retainRows':
      case 'releaseRows': {
        const keys = Array.isArray(input) ? input : (input as { keys?: unknown[] })?.keys
        if (!Array.isArray(keys)) {
          throw new TypeError('window-row-keys-required')
        }
        for (const key of keys) {
          if (name === 'retainRows') {
            this._retained.add(String(key))
          }
          else { this._retained.delete(String(key)) }
        }
        this._trim()
        this._publish()
        return
      }
      default: throw new Error(`controller-command-missing: ${name}`)
    }
  }

  public pause(): void {
    this._paused = true
    this._cancel()
    this._publish()
  }

  public resume(context: ControllerContext): void {
    this._replaceContext(context)
    this._unsubscribe?.()
    this._unsubscribe = this._state.subscribe(() => {
      this._snapshot = null
      this._publish()
    })
    if (!this._disposed) {
      this._paused = false
      this._publish()
      if (!this._initialized && this._props.autoLoad !== false) {
        void this._request('initial')
      }
      else {
        void this._demand()
      }
    }
  }

  public destroy(): void {
    this._disposed = true
    this._cancel()
    this._unsubscribe?.()
    this._unsubscribe = null
    this._cacheUnsubscribe?.()
    this._cacheUnsubscribe = null
    this._retained.clear()
    this._pages.clear()
  }

  private _replaceContext(context: ControllerContext): void {
    const changed = this._context.signal !== context.signal
    this._context = context
    this._state = context.dependencies.state as ControllerStateDependency
    this._load = context.dependencies.load as ControllerQueryDependency
    if (changed && this._unsubscribe) {
      this._snapshot = null
      this._unsubscribe()
      this._unsubscribe = this._state.subscribe(() => {
        this._snapshot = null
        this._publish()
      })
      this._cacheUnsubscribe?.()
      this._cacheUnsubscribe = this._load.cache?.subscribe(() => this._publish()) ?? null
    }
  }

  private _cancel(): void {
    this._generation++
    this._active?.abort()
    this._active = null
    this._activeDirection = null
    this._pending = null
    this._background?.abort()
    this._background = null
    this._backgroundPage = null
    this._pages.forEach((page) => {
      page.attempted = false
    })
  }

  private _read(): CollectionWindowState {
    if (this._snapshot) {
      return this._snapshot
    }
    const value = this._state.read() as CollectionWindowState
    if (!value || !Number.isInteger(value.revision) || !Number.isInteger(value.rowsRevision) || !Array.isArray(value.blocks)) {
      throw new Error('window-state-invalid')
    }
    this._snapshot = value
    return value
  }

  private _rows(state = this._read()): Record<string, unknown>[] {
    return state.blocks.flatMap(block => block.rows)
  }

  private _key(row: Record<string, unknown>): string {
    const value = row[String(this._props.rowKey)]
    if ((typeof value !== 'string' && typeof value !== 'number') || value === '') {
      throw new Error('window-row-key-invalid')
    }
    return String(value)
  }

  private _validateProps(): void {
    if (!['cursor', 'offset'].includes(String(this._props.paging))) {
      throw new Error('window-paging-invalid')
    }
    for (const name of ['batchSize', 'maxLoadedRows']) {
      if (!Number.isInteger(this._props[name]) || Number(this._props[name]) <= 0) {
        throw new Error(`window-${name}-invalid`)
      }
    }
    for (const name of ['prefetchRows', 'initialOffset']) {
      if (!Number.isInteger(this._props[name]) || Number(this._props[name]) < 0) {
        throw new Error(`window-${name}-invalid`)
      }
    }
    if (this._props.retention !== undefined) {
      const retention = this._props.retention as Record<string, unknown>
      if (!retention || Array.isArray(retention) || Object.keys(retention).some(key => !['beforeRows', 'afterRows'].includes(key)) || ['beforeRows', 'afterRows'].some(key => !Number.isSafeInteger(retention[key]) || Number(retention[key]) < Number(this._props.prefetchRows))) {
        throw new Error('window-retention-invalid')
      }
    }
  }

  private _commit(blocks: CollectionWindowBlock[], state = this._read()): void {
    this._snapshot = null
    this._state.commit({
      ...state,
      blocks,
      revision: state.revision + 1,
      rowsRevision: state.rowsRevision + 1,
    }, state.revision)
    const active = new Set(blocks.map(block => block.pageId))
    for (const id of this._pages.keys()) {
      if (!active.has(id)) {
        this._pages.delete(id)
      }
    }
  }

  private _publish(): void {
    if (this._disposed || this._context.signal.aborted) {
      return
    }
    const state = this._read()
    const count = state.blocks.reduce((sum, block) => sum + block.rows.length, 0)
    const changed = state.rowsRevision !== this._publishedRowsRevision
    this._publishedRowsRevision = state.rowsRevision
    this._context.publish({
      ...(changed ? { rows: this._rows(state), rowsRevision: state.rowsRevision } : {}),
      loading: this._active !== null,
      error: this._error,
      hasBefore: state.blocks[0]?.hasBefore ?? false,
      hasAfter: state.blocks.at(-1)?.hasAfter ?? false,
      loadedRowCount: count,
      overLimit: count > Number(this._props.maxLoadedRows),
      refreshPending: this._refreshPending,
      cacheStatus: {
        ...(this._load.cache?.status() ?? { hits: 0, misses: 0, evictions: 0, entries: 0, bytes: 0, pendingWrites: 0, pendingBytes: 0, error: null }),
        source: this._cacheSource,
        stale: this._cacheStale,
        revalidating: this._background !== null,
        ...(this._cacheError ? { error: this._cacheError } : {}),
      },
    })
  }

  private async _reset(forceNetwork = false): Promise<void> {
    this._cancel()
    this._error = null
    this._viewport = null
    this._initialized = false
    this._retained.clear()
    this._pages.clear()
    this._refreshPending = false
    this._cacheError = null
    this._commit([])
    this._publish()
    if ((forceNetwork || this._props.autoLoad !== false) && !this._paused) {
      await this._request('initial', forceNetwork)
    }
  }

  private async _demand(): Promise<void> {
    if (this._active || this._refreshPending || this._error || !this._viewport || this._paused || this._disposed) {
      return
    }
    const state = this._read()
    if (this._viewport.rowsRevision !== state.rowsRevision) {
      return
    }
    const {
      firstVisible: first,
      lastVisible: last,
    } = this._viewport
    if (!first || !last) {
      return
    }
    const rows = this._rows(state)
    // Check visible keys as well as revision to reject malformed/stale geometry.
    if (this._key(rows[first.index] ?? {}) !== String(first.key) || this._key(rows[last.index] ?? {}) !== String(last.key)) {
      return
    }
    if (first.index < Number(this._props.prefetchRows) && state.blocks[0]?.hasBefore) {
      await this._request('before')
    }
    else if (rows.length - last.index - 1 < Number(this._props.prefetchRows) && state.blocks.at(-1)?.hasAfter) {
      await this._request('after')
    }
  }

  private _request(direction: Direction, forceNetwork = false): Promise<void> {
    if (this._pending) {
      return this._pending
    }
    if (this._paused || this._disposed || this._context.signal.aborted || this._error || this._refreshPending) {
      return Promise.resolve()
    }
    const state = this._read()
    const edge = direction === 'before' ? state.blocks[0] : state.blocks.at(-1)
    if (direction !== 'initial' && ((!this._initialized || !edge?.[direction === 'before' ? 'hasBefore' : 'hasAfter']))) {
      return Promise.resolve()
    }
    const limit = Number(this._props.batchSize)
    let offset = Number(this._props.initialOffset)
    if (this._props.paging === 'offset' && edge && direction !== 'initial') {
      offset = direction === 'before' ? Math.max(0, Number(edge.offset) - limit) : Number(edge.offset) + (edge.sourceCount ?? edge.rows.length)
    }
    const cursor = direction === 'before' ? edge?.startCursor : edge?.endCursor
    const edgeSignature = edge ? this._edgeSignature(edge, direction) : null
    // Foreground transport always takes priority over a background revalidation.
    this._background?.abort()
    this._background = null
    const request = {
      ...(this._props.request as Record<string, unknown> ?? {}),
      direction,
      limit: direction === 'before' && this._props.paging === 'offset' ? Math.min(limit, Number(edge?.offset)) : limit,
      ...(this._props.paging === 'cursor'
        ? {
            cursor: direction === 'initial' ? undefined : cursor,
          }
        : {
            offset,
          }),
    }
    const generation = this._generation
    const abort = new AbortController()
    this._active = abort
    this._activeDirection = direction
    const cancel = () => abort.abort()
    this._context.signal.addEventListener('abort', cancel, {
      once: true,
    })
    const executionContext = this._context
    const requestedAt = Date.now()
    this._pending = Promise.resolve().then(async () => {
      try {
        const loaded = await this._loadPage(request, abort.signal, forceNetwork)
        if (generation !== this._generation || abort.signal.aborted || this._disposed) {
          return
        }
        const page = loaded.page
        if (this._load.cache?.status().invalidated) {
          this._refreshPending = true
          return
        }
        const current = this._read()
        const currentEdge = direction === 'before' ? current.blocks[0] : current.blocks.at(-1)
        if (direction !== 'initial' && (!currentEdge || this._edgeSignature(currentEdge, direction) !== edgeSignature)) {
          return
        }
        const existing = this._rows(current)
        const oldKeys = new Set(existing.map(row => this._key(row)))
        if (direction !== 'initial' && !page.rows.some(row => !oldKeys.has(this._key(row))) && page[direction === 'before' ? 'hasBefore' : 'hasAfter']) {
          throw new Error('window-no-progress')
        }
        if (direction !== 'initial' && this._props.paging === 'cursor' && page[direction === 'before' ? 'hasBefore' : 'hasAfter'] && (direction === 'before' ? page.startCursor : page.endCursor) === cursor) {
          throw new Error('window-no-progress')
        }
        const values = new Map(page.rows.map(row => [this._key(row), row]))
        const currentBlocks = current.blocks.map(block => ({
          ...block,
          rows: block.rows.map(row => values.get(this._key(row)) ?? row),
        }))
        const seen = new Set<string>()
        const incoming = {
          ...page,
          pageId: `page-${++this._pageSequence}`,
          rows: page.rows.filter((row) => {
            const key = this._key(row)
            if (seen.has(key) || (direction !== 'initial' && oldKeys.has(key))) {
              return false
            }
            seen.add(key)
            return true
          }).map(row => values.get(this._key(row))!),
        }
        // A terminal page can contain only existing keys. Close the retained edge
        // after deduplication, rather than adding a zero-row block trim can discard.
        const edgeIndex = direction === 'before' ? 0 : currentBlocks.length - 1
        const blocks = direction !== 'initial' && !incoming.rows.length
          ? currentBlocks.map((block, index) => index === edgeIndex
              ? { ...block, [direction === 'before' ? 'hasBefore' : 'hasAfter']: false }
              : block)
          : direction === 'initial' ? [incoming] : direction === 'before' ? [incoming, ...currentBlocks] : [...currentBlocks, incoming]
        if (incoming.rows.length || direction === 'initial') {
          this._pages.set(incoming.pageId, { request, signature: this._pageSignature(page), storedAt: loaded.storedAt, attempted: false })
        }
        this._commit(this._trimBlocks(blocks), current)
        if (loaded.network && this._load.cache && !abort.signal.aborted) {
          const writing = this._load.cache.write(request, page, requestedAt)
          if (this._load.cache.options.storage === 'memory') {
            await writing
          }
          else {
            void writing.then(() => {
              if (!abort.signal.aborted) {
                this._publish()
              }
            }).catch(() => {
            /* A superseded context cannot publish a cache acknowledgement. */
            })
          }
        }
        if (loaded.stale && this._pages.has(incoming.pageId)) {
          this._backgroundPage = incoming.pageId
        }
        this._initialized = true
        this._error = null
      }
      catch (error) {
        if (generation === this._generation && !abort.signal.aborted && !this._disposed && !this._refreshPending) {
          this._error = {
            message: error instanceof Error ? error.message : String(error),
            direction,
          }
        }
      }
      finally {
        executionContext.signal.removeEventListener('abort', cancel)
        if (generation === this._generation) {
          this._active = null
          this._activeDirection = null
          this._pending = null
          this._publish()
          void this._demand()
          this._revalidateVisible()
        }
      }
    })
    this._publish()
    return this._pending
  }

  private _normalize(value: unknown, request: Record<string, unknown>): CollectionWindowBlock {
    const page = value as CollectionWindowBlock
    if (!page || !Array.isArray(page.rows) || page.rows.some(row => !row || typeof row !== 'object')) {
      throw new Error('window-response-invalid')
    }
    page.rows.forEach(row => this._key(row))
    const block = {
      ...page,
      sourceCount: page.rows.length,
      rows: page.rows.map(row => ({
        ...row,
      })),
    }
    if (this._props.paging === 'offset') {
      if (!Number.isInteger(page.offset) || page.offset !== request.offset) {
        throw new Error('window-offset-invalid')
      }
      if (page.total !== undefined && ((!Number.isInteger(page.total) || page.total < 0))) {
        throw new Error('window-total-invalid')
      }
      block.hasBefore = typeof page.hasBefore === 'boolean' ? page.hasBefore : page.offset! > 0
      block.hasAfter = typeof page.hasAfter === 'boolean'
        ? page.hasAfter
        : page.total === undefined
          ? (() => {
              throw new Error('window-continuation-required')
            })()
          : page.offset! + page.rows.length < page.total
    }
    if (typeof block.hasBefore !== 'boolean' || typeof block.hasAfter !== 'boolean') {
      throw new TypeError('window-continuation-required')
    }
    if (this._props.paging === 'cursor' && (((block.hasBefore && ((typeof block.startCursor !== 'string' || !block.startCursor))) || (block.hasAfter && ((typeof block.endCursor !== 'string' || !block.endCursor)))))) {
      throw new Error('window-cursor-required')
    }
    const continuesRequestedEdge = request.direction === 'before' ? block.hasBefore : request.direction === 'after' ? block.hasAfter : block.hasBefore || block.hasAfter
    if (!page.rows.length && continuesRequestedEdge) {
      throw new Error('window-no-progress')
    }
    return block
  }

  private _trim(): void {
    const state = this._read()
    const blocks = this._trimBlocks(state.blocks)
    if (blocks !== state.blocks) {
      this._commit(blocks, state)
    }
  }

  private _trimBlocks(candidate: CollectionWindowBlock[]): CollectionWindowBlock[] {
    if (!this._viewport) {
      return candidate
    }
    const rows = candidate.flatMap(block => block.rows)
    const firstKey = this._viewport.firstVisible?.key
    const lastKey = this._viewport.lastVisible?.key
    let first = rows.findIndex(row => this._key(row) === String(firstKey))
    let last = rows.findIndex(row => this._key(row) === String(lastKey))
    if (first < 0 || last < first) {
      return candidate
    }
    const retention = this._props.retention as { beforeRows: number, afterRows: number } | undefined
    const outerFirst = retention ? Math.max(0, first - retention.beforeRows) : 0
    const outerLast = retention ? Math.min(rows.length - 1, last + retention.afterRows) : rows.length - 1
    const buffer = Number(this._props.prefetchRows)
    first = Math.max(0, first - buffer)
    last = Math.min(rows.length - 1, last + buffer)
    rows.forEach((row, index) => {
      if (this._retained.has(this._key(row))) {
        first = Math.min(first, index)
        last = Math.max(last, index)
      }
    })
    const blocks = [...candidate]
    let count = rows.length
    let start = 0
    let changed = false
    while (blocks.length > 1) {
      const left = blocks[0]!.rows.length
      const right = blocks.at(-1)!.rows.length
      const canLeft = start + left <= first
      const canRight = start + count - right > last
      const outsideLeft = start + left <= outerFirst
      const outsideRight = start + count - right > outerLast
      const pressure = count > Number(this._props.maxLoadedRows)
      if (!pressure && !(canLeft && outsideLeft) && !(canRight && outsideRight)) {
        break
      }
      if (!canLeft && !canRight) {
        break
      }
      if (canLeft && ((outsideLeft && !outsideRight) || !canRight || first - start > start + count - last) && (pressure || outsideLeft)) {
        blocks.shift()
        start += left
        count -= left
      }
      else if (canRight && (pressure || outsideRight)) {
        blocks.pop()
        count -= right
      }
      else { break }
      changed = true
    }
    return changed ? blocks : candidate
  }

  private _edgeSignature(block: CollectionWindowBlock, direction: Direction): string {
    return pageCacheJson([block.pageId, block.offset, block.sourceCount, direction === 'before' ? block.startCursor : block.endCursor, block.rows[0] && this._key(block.rows[0]), block.rows.at(-1) && this._key(block.rows.at(-1)!)])
  }

  private _pageSignature(page: CollectionWindowBlock): string {
    return pageCacheJson([page.rows.map(row => this._key(row)), page.startCursor, page.endCursor, page.offset, page.total, page.hasBefore, page.hasAfter, (page as CollectionWindowBlock & { revision?: unknown }).revision])
  }

  private async _selectCache(): Promise<void> {
    await this._load.cache?.select({ request: this._props.request, paging: this._props.paging, rowKey: this._props.rowKey })
  }

  private async _loadPage(request: Record<string, unknown>, signal: AbortSignal, forceNetwork: boolean): Promise<{ page: CollectionWindowBlock, storedAt: number, network: boolean, stale: boolean }> {
    const cache = this._load.cache
    let cached: Awaited<ReturnType<NonNullable<typeof cache>['read']>>
    if (cache) {
      await this._selectCache()
      if (signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError')
      }
      if (!forceNetwork) {
        cached = await cache.read(request)
      }
      if (!forceNetwork && this._initialized && cache.status().invalidated) {
        this._refreshPending = true
        throw new DOMException('Page chain changed', 'AbortError')
      }
    }
    const age = cached ? Math.max(0, Date.now() - cached.storedAt) : Infinity
    const fresh = age <= (cache?.options.maxAgeMs ?? 0)
    const usable = fresh || (!!cache && cache.options.maxStaleMs > 0 && age <= cache.options.maxAgeMs + cache.options.maxStaleMs)
    if (cached && ((fresh && cache?.options.strategy !== 'network-first') || (usable && cache?.options.strategy === 'stale-while-revalidate'))) {
      try {
        const page = this._normalize(cached.value, request)
        this._cacheSource = cache!.options.storage
        this._cacheStale = !fresh
        return { page, storedAt: cached.storedAt, network: false, stale: !fresh }
      }
      catch {
        await cache!.clear()
        cached = undefined
      }
    }
    try {
      const response = await this._load.run(request, signal)
      const page = this._normalize(response, request)
      this._cacheSource = 'network'
      this._cacheStale = false
      return { page, storedAt: Date.now(), network: true, stale: false }
    }
    catch (error) {
      const status = (error as { response?: { status?: number }, status?: number })?.response?.status ?? (error as { status?: number })?.status
      if (!signal.aborted && status !== 401 && status !== 403 && cached && usable && cache?.options.onError === 'use-cache') {
        this._cacheSource = cache.options.storage
        this._cacheStale = !fresh
        return { page: this._normalize(cached.value, request), storedAt: cached.storedAt, network: false, stale: !fresh }
      }
      throw error
    }
  }

  private _revalidateVisible(): void {
    const cache = this._load.cache
    if (!cache || cache.options.strategy !== 'stale-while-revalidate' || this._active || this._background || this._refreshPending || this._paused || this._disposed || this._context.signal.aborted) {
      return
    }
    const state = this._read()
    const visible = this._viewport?.firstVisible?.key
    const block = state.blocks.find(block => block.rows.some(row => this._key(row) === String(visible)))
    const id = this._backgroundPage ?? block?.pageId
    if (!id) {
      return
    }
    const saved = this._pages.get(id)
    if (!saved || saved.attempted || Date.now() - saved.storedAt <= cache.options.maxAgeMs) {
      return
    }
    saved.attempted = true
    this._cacheStale = true
    this._backgroundPage = null
    const generation = this._generation
    const abort = new AbortController()
    this._background = abort
    const requestedAt = Date.now()
    const cancel = () => abort.abort()
    const contextSignal = this._context.signal
    contextSignal.addEventListener('abort', cancel, { once: true })
    this._publish()
    void (async () => {
      try {
        const response = await this._load.run(saved.request, abort.signal)
        if (abort.signal.aborted || generation !== this._generation || !this._pages.has(id)) {
          return
        }
        if (cache.status().invalidated) {
          this._refreshPending = true
          return
        }
        const page = this._normalize(response, saved.request)
        if (this._pageSignature(page) !== saved.signature) {
          this._refreshPending = true
          await cache.clear(true)
          return
        }
        const current = this._read()
        const values = new Map(page.rows.map(row => [this._key(row), row]))
        let changed = false
        const blocks = current.blocks.map(block => ({ ...block, rows: block.rows.map((row) => {
          const value = values.get(this._key(row))
          if (!value || pageCacheJson(row) === pageCacheJson(value)) {
            return row
          }
          changed = true
          return value
        }) }))
        if (changed) {
          this._commit(blocks, current)
        }
        saved.storedAt = Date.now()
        saved.attempted = false
        this._cacheStale = false
        this._cacheError = null
        await cache.write(saved.request, page, requestedAt)
      }
      catch {
        if (!abort.signal.aborted && generation === this._generation) {
          this._cacheError = 'window-cache-revalidation-failed'
        }
      }
      finally {
        contextSignal.removeEventListener('abort', cancel)
        if (abort.signal.aborted) {
          saved.attempted = false
        }
        if (this._background === abort) {
          this._background = null
          this._publish()
        }
      }
    })()
  }
}
