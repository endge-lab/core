import type { ComponentSFCInteractionTrigger } from '@/modules/domain/types/component/sfc/ir.types'
import type { RuntimeOwnedResource } from '@/modules/runtime/domain/runtime-resource.types'

export interface OperationHistoryShortcutBinding {
  command: 'undo' | 'redo'
  triggers: ComponentSFCInteractionTrigger[]
}

export interface OperationHistoryEntry {
  id: string
  input: unknown
  runOutput: unknown
  undo: () => Promise<unknown>
  redo: () => Promise<unknown>
  undoOutput?: unknown
}

export interface OperationHistoryOptions {
  id: string
  limit?: number
  shortcuts?: OperationHistoryShortcutBinding[] | null
  onChange?: () => void
}

/** Runtime-memory undo/redo cursor. Transitions are serialized and failures keep the cursor stable. */
export class OperationHistory implements RuntimeOwnedResource {
  public readonly kind = 'operation-history'
  public readonly id: string
  private _entries: OperationHistoryEntry[] = []
  private _cursor = 0
  private _paused = false
  private _disposed = false
  private _queue: Promise<unknown> = Promise.resolve()
  private _limit: number

  public constructor(private readonly _options: OperationHistoryOptions) {
    this.id = _options.id
    this._limit = normalizeLimit(_options.limit)
  }

  public get limit(): number { return this._limit }
  public get shortcuts(): OperationHistoryShortcutBinding[] {
    return this._options.shortcuts ?? defaultOperationHistoryShortcuts()
  }

  public get active(): boolean { return !this._paused && !this._disposed }
  public canUndo(): boolean { return this.active && this._cursor > 0 }
  public canRedo(): boolean { return this.active && this._cursor < this._entries.length }

  public setLimit(value: number): void {
    this._limit = normalizeLimit(value)
    this._trim()
    this._options.onChange?.()
  }

  public commit(entry: OperationHistoryEntry): void {
    if (!this.active) {
      return
    }
    if (this._cursor < this._entries.length) {
      this._entries.splice(this._cursor)
    }
    this._entries.push(entry)
    this._cursor = this._entries.length
    this._trim()
    this._options.onChange?.()
  }

  public undo(): Promise<unknown> {
    return this._enqueue(async () => {
      if (!this.canUndo()) {
        return undefined
      }
      const entry = this._entries[this._cursor - 1]!
      const result = await entry.undo()
      entry.undoOutput = result
      this._cursor -= 1
      this._options.onChange?.()
      return result
    })
  }

  public redo(): Promise<unknown> {
    return this._enqueue(async () => {
      if (!this.canRedo()) {
        return undefined
      }
      const entry = this._entries[this._cursor]!
      const result = await entry.redo()
      this._cursor += 1
      this._options.onChange?.()
      return result
    })
  }

  public pause(): void { this._paused = true }
  public resume(): void {
    if (!this._disposed) {
      this._paused = false
    }
  }

  public dispose(): void {
    this._disposed = true
    this._entries = []
    this._cursor = 0
    this._options.onChange?.()
  }

  public snapshot(): { limit: number, cursor: number, size: number, paused: boolean } {
    return { limit: this._limit, cursor: this._cursor, size: this._entries.length, paused: this._paused }
  }

  private _enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this._queue.then(task, task)
    this._queue = result.then(() => undefined, () => undefined)
    return result
  }

  private _trim(): void {
    const overflow = Math.max(0, this._entries.length - this._limit)
    if (!overflow) {
      return
    }
    this._entries.splice(0, overflow)
    this._cursor = Math.max(0, this._cursor - overflow)
  }
}

export function defaultOperationHistoryShortcuts(): OperationHistoryShortcutBinding[] {
  return [
    {
      command: 'undo',
      triggers: [{
        event: 'keydown',
        key: ['z'],
        modifiers: { mod: true, shift: false, exact: true },
        prevent: true,
      }],
    },
    {
      command: 'redo',
      triggers: [{
        event: 'keydown',
        key: ['z'],
        modifiers: { mod: true, shift: true, exact: true },
        prevent: true,
      }],
    },
  ]
}

function normalizeLimit(value: number | undefined): number {
  const number = Number(value ?? 20)
  return Number.isFinite(number) ? Math.max(1, Math.floor(number)) : 20
}
