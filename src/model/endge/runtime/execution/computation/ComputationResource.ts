import type {
  ComputationResource as ComputationResourceContract,
  ComputationRuntimeErrorShape,
} from '@/domain/types/computation'

import { ComputationRuntimeError } from './ComputationGraphExecutor'

type AsyncRunner<T> = (input: unknown) => Promise<T>
type SyncRunner<T> = (input: unknown) => T

/** Renderer-neutral latest-wins state for one computation consumer. */
export class ComputationResourceState<T = unknown> implements ComputationResourceContract<T> {
  private _status: ComputationResourceContract<T>['status'] = 'idle'
  private _value: T | undefined
  private _error: ComputationRuntimeErrorShape | null = null
  private _listeners = new Set<VoidFunction>()
  private _revision = 0
  private _disposed = false
  private _input: unknown

  constructor(
    input: unknown,
    private readonly asyncRunner: AsyncRunner<T>,
    private readonly syncRunner: SyncRunner<T> | null = null,
  ) {
    this._input = input
    if (syncRunner) this.runSync()
    else void this.refresh()
  }

  get status() { return this._status }
  get loading() { return this._status === 'pending' }
  get value() { return this._value }
  get error() { return this._error }

  updateInput(input: unknown): void {
    if (structuralHash(input) === structuralHash(this._input))
      return
    this._input = input
    if (this.syncRunner) this.runSync()
    else void this.refresh()
  }

  async refresh(): Promise<void> {
    if (this._disposed)
      return
    if (this.syncRunner) {
      this.runSync()
      return
    }
    const revision = ++this._revision
    this._status = 'pending'
    this._error = null
    this.notify()
    try {
      const value = await this.asyncRunner(this._input)
      if (this._disposed || revision !== this._revision)
        return
      this._value = value
      this._status = 'success'
      this.notify()
    }
    catch (error) {
      if (this._disposed || revision !== this._revision)
        return
      this._error = normalizeError(error)
      this._status = 'error'
      this.notify()
    }
  }

  subscribe(listener: VoidFunction): VoidFunction {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  dispose(): void {
    this._disposed = true
    this._revision++
    this._listeners.clear()
  }

  private runSync(): void {
    if (!this.syncRunner || this._disposed)
      return
    try {
      this._value = this.syncRunner(this._input)
      this._error = null
      this._status = 'success'
    }
    catch (error) {
      this._error = normalizeError(error)
      this._status = 'error'
    }
    this.notify()
  }

  private notify(): void {
    for (const listener of this._listeners) listener()
  }
}

function normalizeError(error: unknown): ComputationRuntimeErrorShape {
  if (error instanceof ComputationRuntimeError)
    return error.toJSON()
  return {
    name: 'ComputationRuntimeError',
    message: error instanceof Error ? error.message : String(error),
    computationIdentity: 'unknown',
    kind: 'runtime',
  }
}

function structuralHash(value: unknown): string {
  if (value === undefined)
    return 'undefined'
  try { return JSON.stringify(normalizeStructuralValue(value)) ?? String(value) }
  catch { return String(value) }
}

function normalizeStructuralValue(value: unknown): unknown {
  if (value instanceof Date)
    return { $date: value.toISOString() }
  if (Array.isArray(value))
    return value.map(normalizeStructuralValue)
  if (!value || typeof value !== 'object')
    return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => [key, normalizeStructuralValue((value as Record<string, unknown>)[key])]),
  )
}
