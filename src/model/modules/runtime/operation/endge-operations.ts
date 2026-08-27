import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'
import type { OperationHistory } from '@/model/modules/runtime/operation/operation-history'
import { Endge } from '@/model/kernel/endge'
import {
  matchesComponentSFCInteractionTrigger,
  resolveComponentSFCInteractionTriggerPlatform,
} from '@/tools/component-sfc-edit-trigger'

/** Resolves the nearest active Operation History along runtime-scope ancestry. */
export class EndgeOperations {
  private readonly histories = new Map<string, { scope: RuntimeScope, history: OperationHistory }>()
  private latestScopeId: string | null = null
  private keydownDisposer: (() => void) | null = null

  public register(scope: RuntimeScope, history: OperationHistory): () => void {
    if (this.histories.has(scope.id)) {
      throw new Error(`Composition scope "${scope.path}" already owns operationHistory.`)
    }
    this.histories.set(scope.id, { scope, history })
    this.latestScopeId = scope.id
    this.ensureShortcuts()
    return () => {
      if (this.histories.get(scope.id)?.history === history) {
        this.histories.delete(scope.id)
      }
      if (this.latestScopeId === scope.id) {
        this.latestScopeId = [...this.histories.keys()].at(-1) ?? null
      }
      if (!this.histories.size) {
        this.disposeShortcuts()
      }
    }
  }

  public resolveForHost(host: RuntimeHost<any, any> | null | undefined): OperationHistory | null {
    let scope = host ? Endge.runtime.getRuntimeScopeByHost(host.id) : null
    while (scope) {
      const candidate = this.histories.get(scope.id)?.history
      if (candidate?.active) {
        return candidate
      }
      scope = scope.parent
    }
    return null
  }

  public getActiveHistory(): OperationHistory | null {
    if (this.latestScopeId) {
      const latest = this.histories.get(this.latestScopeId)?.history
      if (latest?.active) {
        return latest
      }
    }
    return [...this.histories.values()].reverse().find(item => item.history.active)?.history ?? null
  }

  public undo(): Promise<unknown> { return this.getActiveHistory()?.undo() ?? Promise.resolve(undefined) }
  public redo(): Promise<unknown> { return this.getActiveHistory()?.redo() ?? Promise.resolve(undefined) }
  public canUndo(): boolean { return this.getActiveHistory()?.canUndo() ?? false }
  public canRedo(): boolean { return this.getActiveHistory()?.canRedo() ?? false }

  private ensureShortcuts(): void {
    if (this.keydownDisposer || typeof globalThis.addEventListener !== 'function') {
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
    this.keydownDisposer = () => globalThis.removeEventListener('keydown', listener)
  }

  private disposeShortcuts(): void {
    this.keydownDisposer?.()
    this.keydownDisposer = null
  }
}
