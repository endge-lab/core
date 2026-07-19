import { describe, expect, it, vi } from 'vitest'

import { RAction } from '@/domain/entities/reflect/RAction'
import { EndgeImplementations } from '@/model/endge/runtime/implementation/endge-implementations'
import { compileAction } from '@/model/services/compiler/action/action-compile'
import { validateActionTarget } from '@/model/services/compiler/action/action-target-validation'
import { Endge } from '@/model/endge/kernel/endge'

describe('Action implementation pipeline', () => {
  it('resolves scope precedence and restores the default after dispose', async () => {
    const implementations = new EndgeImplementations()
    implementations.registerProvider(provider('default', 'default'))
    implementations.registerProvider(provider('application', 'application'))
    implementations.registerProvider(provider('workspace', 'workspace'))
    const disposeApplication = implementations.bind(binding('application', 'application'))
    const disposeWorkspace = implementations.bind(binding('workspace', 'workspace', 'main'))

    const request = {
      executable: { type: 'action', identity: 'orders.refresh' },
      defaultProviderKey: 'default',
      scopeIdentities: { workspace: 'main' },
    } as const
    const invocation = { executable: request.executable }

    await expect(implementations.execute(request, invocation)).resolves.toBe('workspace')
    disposeWorkspace()
    await expect(implementations.execute(request, invocation)).resolves.toBe('application')
    disposeApplication()
    await expect(implementations.execute(request, invocation)).resolves.toBe('default')
  })

  it('rejects same-scope same-priority ambiguity', () => {
    const implementations = new EndgeImplementations()
    implementations.registerProvider(provider('one', 1))
    implementations.registerProvider(provider('two', 2))
    implementations.bind(binding('one', 'application'))
    implementations.bind(binding('two', 'application'))

    expect(() => implementations.resolve({
      executable: { type: 'action', identity: 'orders.refresh' },
      defaultProviderKey: null,
    })).toThrowError(expect.objectContaining({ code: 'implementation-binding-ambiguous' }))
  })

  it('rejects a provider whose declared contract does not match the Action', () => {
    const implementations = new EndgeImplementations()
    implementations.registerProvider({
      key: 'orders-only',
      origin: { kind: 'local', owner: 'test' },
      contract: { target: [{ type: 'component.orders' }] },
      execute: vi.fn(),
    })

    expect(() => implementations.resolve({
      executable: { type: 'action', identity: 'table.refresh' },
      defaultProviderKey: 'orders-only',
      expectedContract: { target: [{ type: 'component.table' }] },
    })).toThrowError(expect.objectContaining({ code: 'implementation-contract-incompatible' }))
  })

  it('validates required target alternatives without database ids', () => {
    const contract = [
      { type: 'component.table' },
      { type: 'component.orders', identity: 'main-orders' },
    ]
    expect(() => validateActionTarget(contract, undefined)).toThrowError(expect.objectContaining({ code: 'action-target-required' }))
    expect(() => validateActionTarget(contract, {
      type: 'component.unknown',
      identity: 'unknown',
      value: {},
    })).toThrowError(expect.objectContaining({ code: 'action-target-type-mismatch' }))
    expect(() => validateActionTarget(contract, {
      type: 'component.orders',
      identity: 'other-orders',
      value: {},
    })).toThrowError(expect.objectContaining({ code: 'action-target-identity-mismatch' }))
    expect(() => validateActionTarget(contract, {
      type: 'component.table',
      identity: 'any-table-instance',
      value: {},
    })).not.toThrow()
  })

  it('compiles legacy persisted Flow into Program payload without entity compiled state', () => {
    const action = new RAction()
    action.id = 1
    action.identity = 'orders.refresh'
    action.definition = {
      version: 1,
      entrypoint: 'flow-entry',
      nodes: [{
        id: 'step-1',
        title: 'Refresh',
        kind: 'runtimeAction',
        blockId: 'core.runtime-action',
        params: {},
        meta: { runtimeId: 'refresh', stepKind: 'runtime' },
      }],
      edges: [{
        id: 'edge-1',
        sourceNodeId: 'flow-entry',
        sourcePortId: 'out',
        targetNodeId: 'step-1',
        targetPortId: 'in',
        label: null,
      }],
    }

    const result = compileAction(action)

    expect(result.payload.compiledFlow?.nodesById.has('step-1')).toBe(true)
    expect(result.payload.implementation).toEqual({ kind: 'flow' })
    expect(action.compiledFlow).toBeNull()
  })

  it('defines local code and requires explicit override for collisions', async () => {
    const execute = vi.fn(({ input }) => input)
    const dispose = Endge.actions.defineLocal({
      identity: 'test.local.echo',
      owner: 'test-app',
      execute,
    })

    await expect(Endge.actions.execute('test.local.echo', { input: 'hello' })).resolves.toBe('hello')
    expect(() => Endge.actions.defineLocal({
      identity: 'test.local.echo',
      owner: 'test-app',
      execute,
    })).toThrow('Action identity collision')

    dispose()
    expect(Endge.actions.has('test.local.echo')).toBe(false)
  })

  it('executes Table providers through the unified facade', async () => {
    const setColumnPin = vi.fn()
    const context = {
      surface: 'table-column-header' as const,
      tableRuntimeId: 'table-runtime',
      tableId: 'table',
      target: { setColumnPin },
      columnKey: 'status',
      columnIndex: 0,
      pinnable: true,
      pinMode: 'enabled' as const,
      pinState: 'none' as const,
      defaultPinState: 'none' as const,
      hasPinChanges: false,
      sortable: true,
      sortMode: 'multiple' as const,
      sortState: { active: false },
      activeSortCount: 0,
    }

    await Endge.actions.execute('table.column.pinLeft', context)

    expect(setColumnPin).toHaveBeenCalledWith('status', 'left')
  })

  it('executes a Table Action through a typed target without legacy context', async () => {
    const setColumnPin = vi.fn()

    await Endge.actions.execute('table.column.pinRight', {
      input: { columnKey: 'status' },
      target: {
        type: 'component.table',
        identity: 'orders-table',
        value: { setColumnPin },
      },
    })

    expect(setColumnPin).toHaveBeenCalledWith('status', 'right')
  })

  it('overrides a persisted Action without mutating its Flow and restores default resolution', async () => {
    const action = new RAction()
    action.id = 99100
    action.identity = 'test.persisted.override'
    action.name = action.identity
    action.displayName = action.identity
    const originalDefinition = JSON.stringify(action.definition)
    Endge.domain.addAction(action)
    const dispose = Endge.actions.override(action.identity, {
      owner: 'test-app',
      execute: ({ input }) => ({ overridden: input }),
    })

    await expect(Endge.actions.execute(action.identity, { input: 42 })).resolves.toEqual({ overridden: 42 })
    expect(Endge.actions.listResolved().find(item => item.identity === action.identity)).toMatchObject({
      overridden: true,
      bindingScope: 'application',
    })
    expect(JSON.stringify(action.definition)).toBe(originalDefinition)

    dispose()
    expect(Endge.actions.listResolved().find(item => item.identity === action.identity)).toMatchObject({
      overridden: false,
      bindingScope: 'default',
    })
    Endge.domain.removeActionById(action.id)
  })

  it('never exports virtual Actions even if a caller puts one in a persisted map', () => {
    const action = new RAction()
    action.id = 99101
    action.identity = 'test.virtual.not-exported'
    action.name = action.identity
    action.displayName = action.identity
    action.origin = { kind: 'local', owner: 'test' }
    Endge.domain.addAction(action)

    expect(Endge.domain.toPlain().actions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ identity: action.identity }),
    ]))

    Endge.domain.removeActionById(action.id)
  })
})

function provider(key: string, result: unknown) {
  return {
    key,
    origin: { kind: 'builtin' as const, owner: 'test' },
    execute: vi.fn(() => result),
  }
}

function binding(providerKey: string, scope: 'application' | 'workspace', scopeIdentity?: string) {
  return {
    executableType: 'action',
    executableIdentity: 'orders.refresh',
    providerKey,
    scope,
    scopeIdentity,
  }
}
