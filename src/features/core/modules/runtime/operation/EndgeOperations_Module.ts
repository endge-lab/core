import type { RuntimeHost } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { OperationHistory } from '@/features/core/modules/runtime/operation/operation-history'
import type { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { Endge } from '@/features/core/kernel/endge'
import {
  matchesComponentSFCInteractionTrigger,
  resolveComponentSFCInteractionTriggerPlatform,
} from '@/features/core/modules/domain/component/component-sfc-edit-trigger'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Определяет ближайшую активную Operation History по иерархии runtime-scope. */
export class EndgeOperations_Module extends EndgeModule {
  private readonly _histories = new Map<string, { scope: RuntimeScope, history: OperationHistory }>()
  private _latestScopeId: string | null = null
  private _keydownDisposer: (() => void) | null = null

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  public register(scope: RuntimeScope, history: OperationHistory): () => void {
    if (this._histories.has(scope.id)) {
      throw new Error(`Composition scope "${scope.path}" already owns operationHistory.`)
    }
    this._histories.set(scope.id, { scope, history })
    this._latestScopeId = scope.id
    this._ensureShortcuts()
    return () => {
      if (this._histories.get(scope.id)?.history === history) {
        this._histories.delete(scope.id)
      }
      if (this._latestScopeId === scope.id) {
        this._latestScopeId = [...this._histories.keys()].at(-1) ?? null
      }
      if (!this._histories.size) {
        this._disposeShortcuts()
      }
    }
  }

  public resolveForHost(host: RuntimeHost<any, any> | null | undefined): OperationHistory | null {
    let scope = host ? Endge.runtime.getRuntimeScopeByHost(host.id) : null
    while (scope) {
      const candidate = this._histories.get(scope.id)?.history
      if (candidate?.active) {
        return candidate
      }
      scope = scope.parent
    }
    return null
  }

  public getActiveHistory(): OperationHistory | null {
    if (this._latestScopeId) {
      const latest = this._histories.get(this._latestScopeId)?.history
      if (latest?.active) {
        return latest
      }
    }
    return [...this._histories.values()].reverse().find(item => item.history.active)?.history ?? null
  }

  public undo(): Promise<unknown> { return this.getActiveHistory()?.undo() ?? Promise.resolve(undefined) }
  public redo(): Promise<unknown> { return this.getActiveHistory()?.redo() ?? Promise.resolve(undefined) }
  public canUndo(): boolean { return this.getActiveHistory()?.canUndo() ?? false }
  public canRedo(): boolean { return this.getActiveHistory()?.canRedo() ?? false }

  /** Освобождает histories и глобальный keyboard listener текущего Runtime. */
  public override reset(): void {
    this._histories.clear()
    this._latestScopeId = null
    this._disposeShortcuts()
  }

  /**
   * ----------------------------------------
   * PRIVATE
   * ----------------------------------------
   */

  private _ensureShortcuts(): void {
    if (this._keydownDisposer || typeof globalThis.addEventListener !== 'function') {
      return
    }
    const listener = (event: Event) => {
      const keyboard = event as KeyboardEvent
      const history = this.getActiveHistory()
      if (!history) {
        return
      }
      const platform = resolveComponentSFCInteractionTriggerPlatform(globalThis.navigator?.platform)
      const snapshot = {
        key: keyboard.key,
        code: keyboard.code,
        repeat: keyboard.repeat,
        composing: keyboard.isComposing,
        targetIsCurrentTarget: keyboard.target === keyboard.currentTarget,
        modifiers: {
          ctrl: keyboard.ctrlKey,
          shift: keyboard.shiftKey,
          alt: keyboard.altKey,
          meta: keyboard.metaKey,
          altGraph: keyboard.getModifierState?.('AltGraph') ?? false,
        },
      }
      for (const binding of history.shortcuts) {
        const trigger = binding.triggers.find(candidate =>
          candidate.event === keyboard.type
          && matchesComponentSFCInteractionTrigger(candidate, snapshot, platform),
        )
        if (!trigger) {
          continue
        }
        if (trigger.prevent !== false) {
          keyboard.preventDefault()
        }
        if (trigger.stop) {
          keyboard.stopPropagation()
        }
        void (binding.command === 'redo' ? history.redo() : history.undo())
        return
      }
    }
    globalThis.addEventListener('keydown', listener)
    this._keydownDisposer = () => globalThis.removeEventListener('keydown', listener)
  }

  private _disposeShortcuts(): void {
    this._keydownDisposer?.()
    this._keydownDisposer = null
  }
}
