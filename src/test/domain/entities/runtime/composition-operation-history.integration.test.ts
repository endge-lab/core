import { afterEach, describe, expect, it, vi } from 'vitest'

import { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import { Endge } from '@/model/kernel/endge'
import { EndgeOperations } from '@/model/modules/runtime/operation/endge-operations'
import { OperationHistory } from '@/model/modules/runtime/operation/operation-history'
import { compileCompositionSource } from '@/model/services/source-engine/compilers/composition-source-compile'

describe('composition Operation History integration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('compiles one History resource with configuration-backed limit and TriggerSets', () => {
    const result = compileCompositionSource(`defineComposition({
      resources: {
        operations: operationHistory({
          limit: $editing.operationHistoryLimit,
          shortcuts: [
            onShortcut($editing.shortcuts.undo).undo(),
            onShortcut([{ event: 'keydown', key: ['y'], modifiers: { mod: true }, prevent: true }]).redo(),
          ],
        }),
      },
      runtimes: {},
    })`)
    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.artifact?.resources[0]).toMatchObject({
      kind: 'operation-history',
      operationHistory: {
        limit: 20,
        limitConfigurationPath: 'editing.operationHistoryLimit',
        shortcuts: [
          { command: 'undo', triggerSet: { kind: 'configuration', path: 'editing.shortcuts.undo' } },
          { command: 'redo', triggerSet: { kind: 'literal' } },
        ],
      },
    })
  })

  it('rejects two History aliases in one Composition scope', () => {
    const result = compileCompositionSource(`defineComposition({
      resources: {
        first: operationHistory({ limit: 10 }),
        second: operationHistory({ limit: 20 }),
      },
      runtimes: {},
    })`)
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'composition-operation-history-conflict' }))
  })

  it('resolves the nearest active History and falls back to its parent while paused', () => {
    const root = new RuntimeScope({ id: 'root', path: 'root' })
    const child = new RuntimeScope({ id: 'child', path: 'root.child', parent: root })
    const rootHistory = new OperationHistory({ id: 'root-history' })
    const childHistory = new OperationHistory({ id: 'child-history' })
    const operations = new EndgeOperations()
    const removeRoot = operations.register(root, rootHistory)
    const removeChild = operations.register(child, childHistory)
    vi.spyOn(Endge.runtime, 'getRuntimeScopeByHost').mockReturnValue(child)

    expect(operations.resolveForHost({ id: 'host' } as any)).toBe(childHistory)
    childHistory.pause()
    expect(operations.resolveForHost({ id: 'host' } as any)).toBe(rootHistory)
    childHistory.resume()
    expect(operations.resolveForHost({ id: 'host' } as any)).toBe(childHistory)

    removeChild()
    childHistory.dispose()
    removeRoot()
    rootHistory.dispose()
  })

  it('dispatches a custom TriggerSet and prevents the browser default', async () => {
    const listeners: Record<string, (event: Event) => void> = {}
    vi.stubGlobal('addEventListener', vi.fn((name: string, next: (event: Event) => void) => {
      listeners[name] = next
    }))
    vi.stubGlobal('removeEventListener', vi.fn())
    const scope = new RuntimeScope({ id: 'scope', path: 'scope' })
    const undo = vi.fn(async () => undefined)
    const history = new OperationHistory({
      id: 'history',
      shortcuts: [{
        command: 'undo',
        triggers: [{ event: 'keydown', key: ['u'], modifiers: { ctrl: true }, prevent: true }],
      }],
    })
    history.commit({ id: 'entry', input: {}, runOutput: null, undo, redo: vi.fn() })
    const operations = new EndgeOperations()
    const remove = operations.register(scope, history)
    const preventDefault = vi.fn()
    const dispatch = listeners.keydown
    expect(dispatch).toBeTypeOf('function')
    dispatch!({
      type: 'keydown',
      key: 'u',
      code: 'KeyU',
      repeat: false,
      isComposing: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      metaKey: false,
      target: null,
      currentTarget: null,
      getModifierState: () => false,
      preventDefault,
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent)
    await vi.waitFor(() => expect(undo).toHaveBeenCalledOnce())
    expect(preventDefault).toHaveBeenCalledOnce()
    remove()
    history.dispose()
    vi.unstubAllGlobals()
  })
})
