import type { ComponentSFCInteractionTrigger } from '@/domain/types/component/sfc/ir.types'
import type { RuntimeOwnedResource } from '@/domain/types/runtime/runtime-resource.types'

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
  private entries: OperationHistoryEntry[] = []
  private cursor = 0
  private paused = false
  private disposed = false
  private queue: Promise<unknown> = Promise.resolve()
  private _limit: number

  public constructor(private readonly options: OperationHistoryOptions) {
    this.id = options.id
    this._limit = normalizeLimit(options.limit)
  }

  public get limit(): number { return this._limit }
  public get shortcuts(): OperationHistoryShortcutBinding[] {
    return this.options.shortcuts ?? defaultOperationHistoryShortcuts()
  }

  public get active(): boolean { return !this.paused && !this.disposed }
  public canUndo(): boolean { return this.active && this.cursor > 0 }
  public canRedo(): boolean { return this.active && this.cursor < this.entries.length }

  public setLimit(value: number): void {
    this._limit = normalizeLimit(value)
    this.trim()
    this.options.onChange?.()
  }

  public commit(entry: OperationHistoryEntry): void {
    if (!this.active) {
      return
    }
    if (this.cursor < this.entries.length) {
      this.entries.splice(this.cursor)
    }
    this.entries.push(entry)
    this.cursor = this.entries.length
    this.trim()
    this.options.onChange?.()
  }

  public undo(): Promise<unknown> {
    return this.enqueue(async () => {
      if (!this.canUndo()) {
        return undefined
      }
      const entry = this.entries[this.cursor - 1]!
      const result = await entry.undo()
      entry.undoOutput = result
      this.cursor -= 1
      this.options.onChange?.()
      return result
    })
  }

  public redo(): Promise<unknown> {
    return this.enqueue(async () => {
      if (!this.canRedo()) {
        return undefined
      }
      const entry = this.entries[this.cursor]!
      const result = await entry.redo()
      this.cursor += 1
      this.options.onChange?.()
      return result
    })
  }

  public pause(): void { this.paused = true }
  public resume(): void {
    if (!this.disposed) {
      this.paused = false
    }
  }

  public dispose(): void {
    this.disposed = true
    this.entries = []
    this.cursor = 0
    this.options.onChange?.()
  }

  public snapshot(): { limit: number, cursor: number, size: number, paused: boolean } {
    return { limit: this._limit, cursor: this.cursor, size: this.entries.length, paused: this.paused }
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  private trim(): void {
    const overflow = Math.max(0, this.entries.length - this._limit)
    if (!overflow) {
      return
    }
    this.entries.splice(0, overflow)
    this.cursor = Math.max(0, this.cursor - overflow)
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
