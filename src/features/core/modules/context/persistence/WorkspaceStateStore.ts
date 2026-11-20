import type { DBSchema, IDBPDatabase } from 'idb'
import type {
  EndgeWorkspaceStateBatchResult,
  EndgeWorkspaceStateOperation,
  EndgeWorkspaceStateScope,
  EndgeWorkspaceStateSnapshot,
  EndgeWorkspaceStateSyncStatus,
  EndgeWorkspaceStateTransport,
} from '@/features/core/modules/context/domain/workspace-state.types'
import type { EndgeJSONValue } from '@/features/core/modules/source/domain/types/configuration-source.types'

import { openDB } from 'idb'

import { EndgeWorkspaceStateRequestError } from '@/features/core/modules/context/persistence/BackendWorkspaceStateTransport'

interface QueuedSetting extends EndgeWorkspaceStateOperation {
  resetRevision: number | null
  predecessor?: string
  conflicted?: boolean
}

interface WorkspaceStateRecord {
  values: Record<string, EndgeJSONValue>
  snapshot: EndgeWorkspaceStateSnapshot | null
  queue: QueuedSetting[]
}

interface WorkspaceStateDatabase extends DBSchema {
  contexts: { key: string, value: WorkspaceStateRecord }
}

const BATCH_SIZE = 32
const MAX_BATCH_BYTES = 64 * 1024
const MAX_VALUE_BYTES = 60 * 1024
const DEBOUNCE_MS = 250
const REQUEST_TIMEOUT_MS = 3000
const RETRY_MAX_MS = 30000

function emptyRecord(): WorkspaceStateRecord {
  return { values: {}, snapshot: null, queue: [] }
}

function setValue(values: Record<string, EndgeJSONValue>, key: string, value: EndgeJSONValue | undefined): void {
  if (value === undefined) {
    delete values[key]
  }
  else {
    Object.defineProperty(values, key, { value, configurable: true, enumerable: true, writable: true })
  }
}

function revision(record: WorkspaceStateRecord, key: string): number {
  return record.snapshot?.entries.find(entry => entry.key === key)?.revision ?? 0
}

function fitsServer(key: string, value: EndgeJSONValue | undefined): boolean {
  const encoder = new TextEncoder()
  return key.length > 0 && key.trim() === key && !/\p{Cc}/u.test(key)
    && encoder.encode(key).length <= 512
    && (value === undefined || encoder.encode(JSON.stringify(value)).length <= MAX_VALUE_BYTES)
}

export class WorkspaceStateStore {
  private readonly _abort = new AbortController()
  private _database: Promise<IDBPDatabase<WorkspaceStateDatabase>> | null = null
  private _record = emptyRecord()
  private readonly _drafts = new Map<string, { value: EndgeJSONValue | undefined, operation?: QueuedSetting }>()
  private _disk = Promise.resolve()
  private _volatile = false
  private _timer: ReturnType<typeof setTimeout> | undefined
  private _synching = false
  private _inFlight = new Set<string>()
  private _retryMs = 1000
  private _confirmedSnapshot = false
  private _error: EndgeWorkspaceStateSyncStatus['error'] = null

  public constructor(
    public readonly id: string,
    private readonly _scope: () => EndgeWorkspaceStateScope,
    private readonly _transport: EndgeWorkspaceStateTransport | null,
    private readonly _onChange: (keys: readonly string[]) => void,
  ) {}

  public get status(): EndgeWorkspaceStateSyncStatus {
    const pending = new Set(this._record.queue.filter(op => !op.conflicted).map(op => op.key))
    this._drafts.forEach((draft, key) => {
      if (draft.operation && !draft.operation.conflicted) {
        pending.add(key)
      }
    })
    return {
      pending: pending.size,
      conflicts: this._record.queue.filter(op => op.conflicted).map(op => op.key),
      error: this._error ?? (this._volatile ? 'storage' : null),
    }
  }

  public get(key: string): EndgeJSONValue | undefined {
    if (this._transport && this._error === 'session') {
      return undefined
    }
    const draft = this._drafts.get(key)
    if (draft && !draft.operation?.conflicted) {
      return draft.value
    }
    const queued = this._record.queue.find(op => op.key === key)
    if (queued && !queued.conflicted) {
      return queued.value
    }
    if (this._transport) {
      const entry = this._record.snapshot?.entries.find(entry => entry.key === key)
      return entry?.deleted ? undefined : entry?.value
    }
    return Object.hasOwn(this._record.values, key) ? this._record.values[key] : undefined
  }

  public getWithLegacy(key: string, readLegacy: () => EndgeJSONValue | undefined): EndgeJSONValue | undefined {
    const value = this.get(key)
    if (!this._transport || this._error === 'session' || value !== undefined
      || this._drafts.has(key) || this._record.queue.some(op => op.key === key)
      || this._record.snapshot?.entries.some(entry => entry.key === key)
      || (this._record.snapshot?.resetRevision ?? 0) > 0) {
      return value
    }
    const legacy = readLegacy()
    if (legacy !== undefined && this._confirmedSnapshot && fitsServer(key, legacy)) {
      this.set(key, legacy)
    }
    return legacy
  }

  public async load(): Promise<void> {
    await this._persist(() => {}, false)
    if (this._abort.signal.aborted) {
      return
    }
    if (this._transport) {
      globalThis.addEventListener?.('online', this._onOnline)
      await this._sync(true, true)
    }
  }

  public set(key: string, value: EndgeJSONValue | undefined): void {
    if (this._transport && !fitsServer(key, value)) {
      throw new Error('[EndgeContext] A server setting requires a valid key and a value of at most 60 KiB.')
    }
    const previous = this._drafts.get(key)?.operation ?? this._record.queue.find(op => op.key === key)
    const operation: QueuedSetting | undefined = this._transport
      ? {
          key,
          id: crypto.randomUUID(),
          baseRevision: previous?.baseRevision ?? revision(this._record, key),
          resetRevision: previous ? previous.resetRevision : (this._record.snapshot?.resetRevision ?? null),
          predecessor: previous && this._inFlight.has(previous.id) ? previous.id : previous?.predecessor,
          ...(value === undefined ? { delete: true } : { value }),
          ...(previous?.conflicted ? { conflicted: true } : {}),
        }
      : undefined
    const draft = { value, operation }
    this._drafts.set(key, draft)
    void this._persist((record) => {
      if (operation) {
        if ((operation.resetRevision ?? 0) >= (record.snapshot?.resetRevision ?? 0)) {
          record.queue = record.queue.filter(item => item.key !== key)
          record.queue.push(operation)
        }
      }
      else {
        setValue(record.values, key, value)
      }
    }).catch(() => {}).then(() => {
      if (this._drafts.get(key) === draft) {
        this._drafts.delete(key)
      }
      if (operation) {
        this._schedule(DEBOUNCE_MS, false)
      }
      if (!this._abort.signal.aborted) {
        this._onChange([key])
      }
    })
    this._onChange([key])
  }

  public async resolveConflict(key: string, action: 'retry' | 'discard'): Promise<void> {
    const pending = this._record.queue.find(op => op.key === key && op.conflicted)
    if (!pending) {
      return
    }
    await this._persist((record) => {
      record.queue = record.queue.filter(op => op.id !== pending.id)
      if (action === 'retry' && !record.queue.some(op => op.key === key)) {
        record.queue.push({
          ...pending,
          id: crypto.randomUUID(),
          baseRevision: revision(record, key),
          resetRevision: record.snapshot?.resetRevision ?? null,
          conflicted: false,
          predecessor: undefined,
        })
      }
    })
    this._onChange([key])
    if (action === 'retry') {
      this._schedule(0, false)
    }
  }

  public dispose(): void {
    this._abort.abort()
    clearTimeout(this._timer)
    globalThis.removeEventListener?.('online', this._onOnline)
    void this._disk.finally(() => this._database?.then(db => db.close(), () => {}))
  }

  private readonly _onOnline = (): void => {
    this._schedule(0, true)
  }

  private _schedule(delay: number, refresh: boolean): void {
    if (this._abort.signal.aborted) {
      return
    }
    if (this._timer && !refresh) {
      return
    }
    clearTimeout(this._timer)
    this._timer = setTimeout(() => {
      this._timer = undefined
      void this._sync(refresh)
    }, delay)
  }

  private async _sync(refresh: boolean, hydrateOnly = false): Promise<void> {
    const transport = this._transport
    if (this._abort.signal.aborted || !transport || this._synching) {
      return
    }
    this._synching = true
    try {
      const scope = this._scope()
      await this._disk
      if (refresh || !this._record.snapshot) {
        const snapshot = await transport.read(scope, this._requestSignal())
        this._abort.signal.throwIfAborted()
        if (snapshot.application !== scope.application) {
          throw new EndgeWorkspaceStateRequestError(403)
        }
        const previous = this._record.snapshot
        // A cookie or token rotation must never move a queued write to a different account.
        if (previous && previous.actorId !== snapshot.actorId) {
          throw new EndgeWorkspaceStateRequestError(403)
        }
        this._error = null
        this._confirmedSnapshot = true
        await this._persist(record => this._acceptSnapshot(record, snapshot))
      }
      const snapshot = this._record.snapshot
      if (!snapshot) {
        return
      }
      if (hydrateOnly) {
        if (this.status.pending) {
          this._schedule(0, false)
        }
        return
      }
      const batch = {
        actorId: snapshot.actorId,
        partition: snapshot.partition,
        resetRevision: snapshot.resetRevision,
        operations: [] as EndgeWorkspaceStateOperation[],
      }
      const queue: QueuedSetting[] = []
      const encoder = new TextEncoder()
      let bytes = encoder.encode(JSON.stringify(batch)).length
      for (const op of this._record.queue) {
        if (op.conflicted) {
          continue
        }
        const { key, id, baseRevision, value, delete: remove } = op
        const operation = { key, id, baseRevision, value, delete: remove }
        const nextBytes = bytes + encoder.encode(JSON.stringify(operation)).length + (queue.length ? 1 : 0)
        if (nextBytes > MAX_BATCH_BYTES) {
          if (!queue.length) {
            throw new EndgeWorkspaceStateRequestError(413)
          }
          break
        }
        batch.operations.push(operation)
        queue.push(op)
        bytes = nextBytes
        if (queue.length === BATCH_SIZE) {
          break
        }
      }
      if (queue.length === 0) {
        this._error = null
        return
      }
      this._inFlight = new Set(queue.map(op => op.id))
      const response = await transport.save(scope, batch, this._requestSignal())
      this._abort.signal.throwIfAborted()
      this._error = null
      await this._persist(record => this._applyResult(record, queue, response))
      this._retryMs = 1000
      if (response.resetRevision > snapshot.resetRevision) {
        this._schedule(0, true)
      }
      else if (this.status.pending) {
        this._schedule(0, false)
      }
    }
    catch (error) {
      if (this._abort.signal.aborted) {
        return
      }
      this._error = error instanceof EndgeWorkspaceStateRequestError && error.status < 500 && error.status !== 429 ? 'session' : 'network'
      if (this._error === 'session') {
        this._confirmedSnapshot = false
        this._onChange(this._record.snapshot?.entries.map(entry => entry.key) ?? [])
      }
      else {
        this._schedule(this._retryMs, true)
        this._retryMs = Math.min(this._retryMs * 2, RETRY_MAX_MS)
      }
    }
    finally {
      this._inFlight.clear()
      this._synching = false
      if (!this._abort.signal.aborted) {
        this._onChange([])
      }
    }
  }

  private _requestSignal(): AbortSignal {
    return AbortSignal.any([this._abort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
  }

  private _acceptSnapshot(record: WorkspaceStateRecord, snapshot: EndgeWorkspaceStateSnapshot): void {
    if (record.snapshot && record.snapshot.actorId !== snapshot.actorId) {
      throw new EndgeWorkspaceStateRequestError(403)
    }
    if (record.snapshot && record.snapshot.partition !== snapshot.partition) {
      record.snapshot = snapshot
      record.queue = []
      return
    }
    if (record.snapshot && record.snapshot.resetRevision > snapshot.resetRevision) {
      return
    }
    const entries = new Map(snapshot.entries.map(entry => [entry.key, entry]))
    if (record.snapshot?.resetRevision === snapshot.resetRevision) {
      for (const entry of record.snapshot.entries) {
        if (entry.revision > (entries.get(entry.key)?.revision ?? 0)) {
          entries.set(entry.key, entry)
        }
      }
    }
    record.snapshot = { ...snapshot, entries: [...entries.values()] }
    record.queue = record.queue.filter(op => (op.resetRevision ?? 0) >= snapshot.resetRevision)
  }

  private _applyResult(record: WorkspaceStateRecord, sent: QueuedSetting[], response: EndgeWorkspaceStateBatchResult): void {
    const snapshot = record.snapshot
    if (!snapshot || snapshot.resetRevision > response.resetRevision) {
      return
    }
    if (snapshot.resetRevision < response.resetRevision) {
      snapshot.resetRevision = response.resetRevision
      snapshot.entries = []
      record.queue = record.queue.filter(op => (op.resetRevision ?? 0) >= response.resetRevision)
    }
    for (const result of response.results) {
      const op = sent.find(item => item.key === result.key)
      if (!op) {
        continue
      }
      const currentRevision = revision(record, op.key)
      if (result.entry && result.entry.revision >= currentRevision) {
        snapshot.entries = snapshot.entries.filter(entry => entry.key !== op.key)
        snapshot.entries.push(result.entry)
      }
      record.queue = record.queue.flatMap((item) => {
        if (item.id === op.id) {
          return result.status === 'conflict' ? [{ ...item, conflicted: true }] : []
        }
        if (item.predecessor === op.id) {
          return result.status === 'saved' && result.entry
            ? [{ ...item, baseRevision: result.entry.revision, predecessor: undefined }]
            : [{ ...item, conflicted: true, predecessor: undefined }]
        }
        return [item]
      })
    }
  }

  private _persist(mutate: (record: WorkspaceStateRecord) => void, remember = true): Promise<void> {
    const run = async (): Promise<void> => {
      const before = this._record
      let record: WorkspaceStateRecord
      if (this._volatile) {
        record = structuredClone(before)
        mutate(record)
      }
      else {
        try {
          this._database ??= openDB<WorkspaceStateDatabase>('endge-workspace-state', 1, {
            upgrade: db => db.createObjectStore('contexts'),
          })
          const db = await this._database
          const tx = db.transaction('contexts', 'readwrite')
          record = await tx.store.get(this.id) ?? emptyRecord()
          try {
            mutate(record)
          }
          catch (error) {
            tx.abort()
            await tx.done.catch(() => {})
            throw error
          }
          if (remember) {
            await tx.store.put(record, this.id)
          }
          await tx.done
        }
        catch (error) {
          if (error instanceof EndgeWorkspaceStateRequestError) {
            throw error
          }
          this._volatile = true
          record = structuredClone(before)
          mutate(record)
        }
      }
      const keys = new Set([
        ...Object.keys(before.values),
        ...Object.keys(record.values),
        ...(before.snapshot?.entries.map(entry => entry.key) ?? []),
        ...(record.snapshot?.entries.map(entry => entry.key) ?? []),
        ...before.queue.map(op => op.key),
        ...record.queue.map(op => op.key),
      ])
      this._record = record
      if (!this._abort.signal.aborted) {
        this._onChange([...keys])
      }
    }
    const next = this._disk.then(run)
    this._disk = next.catch(() => {
      this._error = 'storage'
      if (!this._abort.signal.aborted) {
        this._onChange([])
      }
    })
    return remember ? next : this._disk
  }
}
