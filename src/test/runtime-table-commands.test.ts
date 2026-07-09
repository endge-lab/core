import { describe, expect, it, vi } from 'vitest'

import type { TableColumnCommandContext } from '@/domain/types/command.types'
import { RuntimeCommandRegistry } from '@/domain/entities/runtime/RuntimeCommandRegistry'
import { createTableRuntimeCommands } from '@/domain/services/runtime/table-commands'
import { TABLE_RUNTIME_COMMAND_IDS } from '@/domain/types/command.types'

describe('Runtime table commands', () => {
  it('runs column sort commands against the table runtime target', async () => {
    const registry = createRegistry()
    const setColumnSort = vi.fn()
    const context = createContext({
      target: {
        setColumnSort,
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortSetColumnAsc, context)).toBe(true)

    await registry.execute(TABLE_RUNTIME_COMMAND_IDS.sortSetColumnAsc, context)

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

    expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortClearColumn, context)).toBe(true)

    await registry.execute(TABLE_RUNTIME_COMMAND_IDS.sortClearColumn, context)

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

    expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortClearAll, inactiveContext)).toBe(false)
    expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortClearAll, activeContext)).toBe(true)

    await registry.execute(TABLE_RUNTIME_COMMAND_IDS.sortClearAll, activeContext)

    expect(clearAllSort).toHaveBeenCalledTimes(1)
  })

  it('disables mutable sort commands for disabled and fixed sort modes', () => {
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

      expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortSetColumnAsc, context)).toBe(false)
      expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortSetColumnDesc, context)).toBe(false)
      expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortClearColumn, context)).toBe(false)
      expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortClearAll, context)).toBe(false)
    }
  })

  it('does not allow column sort commands for non-sortable columns', () => {
    const registry = createRegistry()
    const context = createContext({
      sortable: false,
      target: {
        setColumnSort: vi.fn(),
      },
    })

    expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortSetColumnAsc, context)).toBe(false)
    expect(registry.canExecute(TABLE_RUNTIME_COMMAND_IDS.sortSetColumnDesc, context)).toBe(false)
  })
})

function createRegistry(): RuntimeCommandRegistry {
  const registry = new RuntimeCommandRegistry()
  registry.registerMany(createTableRuntimeCommands())
  return registry
}

function createContext(
  overrides: Partial<TableColumnCommandContext> = {},
): TableColumnCommandContext {
  return {
    surface: 'table-column-header',
    runtimeId: 'table-runtime',
    tableRuntimeId: 'table-runtime',
    tableId: 'table',
    target: {},
    columnKey: 'number',
    columnIndex: 0,
    pinState: 'none',
    sortable: true,
    sortMode: 'multiple',
    sortState: {
      active: false,
    },
    activeSortCount: 0,
    ...overrides,
  }
}
