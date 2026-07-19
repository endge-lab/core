import { describe, expect, it, vi } from 'vitest'

import type { TableColumnActionContext } from '@/domain/types/runtime/action.types'
import { RuntimeActionRegistry } from '@/domain/entities/runtime/RuntimeActionRegistry'
import { createTableRuntimeActions } from '@/model/services/runtime/table-actions'
import { TABLE_RUNTIME_ACTION_IDS } from '@/domain/types/runtime/action.types'

describe('Runtime table actions', () => {
  it('hides a hideable column through the mounted table target', async () => {
    const registry = createRegistry()
    const setColumnVisibility = vi.fn()
    const context = createContext({ target: { setColumnVisibility } })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnHide, context)).toBe(true)
    await registry.execute(TABLE_RUNTIME_ACTION_IDS.columnHide, context)
    expect(setColumnVisibility).toHaveBeenCalledWith('number', false)
  })

  it('runs column sort actions against the table runtime target', async () => {
    const registry = createRegistry()
    const setColumnSort = vi.fn()
    const context = createContext({
      target: {
        setColumnSort,
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortSetColumnAsc, context)).toBe(true)

    await registry.execute(TABLE_RUNTIME_ACTION_IDS.sortSetColumnAsc, context)

    expect(setColumnSort).toHaveBeenCalledWith('number', 'asc')
  })

  it('clears only the active column sort', async () => {
    const registry = createRegistry()
    const clearColumnSort = vi.fn()
    const context = createContext({
      sortState: {
        active: true,
        direction: 'desc',
        index: 0,
      },
      activeSortCount: 2,
      target: {
        clearColumnSort,
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortClearColumn, context)).toBe(true)

    await registry.execute(TABLE_RUNTIME_ACTION_IDS.sortClearColumn, context)

    expect(clearColumnSort).toHaveBeenCalledWith('number')
  })

  it('clears all sorts only when table has active sorts', async () => {
    const registry = createRegistry()
    const clearAllSort = vi.fn()
    const inactiveContext = createContext({
      activeSortCount: 0,
      target: {
        clearAllSort,
      },
    })
    const activeContext = createContext({
      activeSortCount: 1,
      target: {
        clearAllSort,
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortClearAll, inactiveContext)).toBe(false)
    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortClearAll, activeContext)).toBe(true)

    await registry.execute(TABLE_RUNTIME_ACTION_IDS.sortClearAll, activeContext)

    expect(clearAllSort).toHaveBeenCalledTimes(1)
  })

  it('disables mutable sort actions for disabled and fixed sort modes', () => {
    const registry = createRegistry()
    const target = {
      setColumnSort: vi.fn(),
      clearColumnSort: vi.fn(),
      clearAllSort: vi.fn(),
    }

    for (const sortMode of ['disabled', 'fixed'] as const) {
      const context = createContext({
        sortMode,
        sortState: {
          active: true,
          direction: 'asc',
          index: 0,
        },
        activeSortCount: 1,
        target,
      })

      expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortSetColumnAsc, context)).toBe(false)
      expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortSetColumnDesc, context)).toBe(false)
      expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortClearColumn, context)).toBe(false)
      expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortClearAll, context)).toBe(false)
    }
  })

  it('does not allow column sort actions for non-sortable columns', () => {
    const registry = createRegistry()
    const context = createContext({
      sortable: false,
      target: {
        setColumnSort: vi.fn(),
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortSetColumnAsc, context)).toBe(false)
    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.sortSetColumnDesc, context)).toBe(false)
  })

  it('runs column pin actions against the table runtime target', async () => {
    const registry = createRegistry()
    const setColumnPin = vi.fn()
    const context = createContext({
      target: {
        setColumnPin,
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnPinLeft, context)).toBe(true)

    await registry.execute(TABLE_RUNTIME_ACTION_IDS.columnPinLeft, context)

    expect(setColumnPin).toHaveBeenCalledWith('number', 'left')
  })

  it('resets column pin and all pins to default state', async () => {
    const registry = createRegistry()
    const resetColumnPin = vi.fn()
    const resetAllPins = vi.fn()
    const context = createContext({
      pinState: 'left',
      defaultPinState: 'none',
      hasPinChanges: true,
      target: {
        resetColumnPin,
        resetAllPins,
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnResetPin, context)).toBe(true)
    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnResetAllPins, context)).toBe(true)

    await registry.execute(TABLE_RUNTIME_ACTION_IDS.columnResetPin, context)
    await registry.execute(TABLE_RUNTIME_ACTION_IDS.columnResetAllPins, context)

    expect(resetColumnPin).toHaveBeenCalledWith('number')
    expect(resetAllPins).toHaveBeenCalledTimes(1)
  })

  it('disables pin actions when column pinning is disabled or column is not pinnable', () => {
    const registry = createRegistry()
    const target = {
      setColumnPin: vi.fn(),
      resetColumnPin: vi.fn(),
      resetAllPins: vi.fn(),
    }
    const disabledContext = createContext({
      pinMode: 'disabled',
      hasPinChanges: true,
      target,
    })
    const nonPinnableContext = createContext({
      pinnable: false,
      hasPinChanges: true,
      target,
    })

    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnPinLeft, disabledContext)).toBe(false)
    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnResetAllPins, disabledContext)).toBe(false)
    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnPinRight, nonPinnableContext)).toBe(false)
    expect(registry.canExecute(TABLE_RUNTIME_ACTION_IDS.columnResetPin, nonPinnableContext)).toBe(false)
  })
})

function createRegistry(): RuntimeActionRegistry {
  const registry = new RuntimeActionRegistry()
  registry.registerMany(createTableRuntimeActions())
  return registry
}

function createContext(
  overrides: Partial<TableColumnActionContext> = {},
): TableColumnActionContext {
  return {
    surface: 'table-column-header',
    runtimeId: 'table-runtime',
    tableRuntimeId: 'table-runtime',
    tableId: 'table',
    target: {},
    columnKey: 'number',
    columnIndex: 0,
    hideable: true,
    pinnable: true,
    pinMode: 'enabled',
    pinState: 'none',
    defaultPinState: 'none',
    hasPinChanges: false,
    sortable: true,
    sortMode: 'multiple',
    sortState: {
      active: false,
    },
    activeSortCount: 0,
    ...overrides,
  }
}
