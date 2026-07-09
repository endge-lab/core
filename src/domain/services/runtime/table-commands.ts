import type {
  RuntimeCommand,
  TableColumnCommandContext,
  TableColumnPinSide,
  TableRuntimeCommandTarget,
  TableSortDirection,
} from '@/domain/types/command.types'
import { TABLE_RUNTIME_COMMAND_IDS } from '@/domain/types/command.types'

type TableTargetMethodName = keyof TableRuntimeCommandTarget

export function createTableRuntimeCommands(): RuntimeCommand<TableColumnCommandContext>[] {
  return [
    {
      id: TABLE_RUNTIME_COMMAND_IDS.columnPinLeft,
      label: 'Закрепить слева',
      surface: 'table-column-header',
      canExecute: context => context.pinState !== 'left' && hasTargetMethod(context, 'setColumnPin'),
      execute: context => executeSetColumnPin(context, 'left'),
    },
    {
      id: TABLE_RUNTIME_COMMAND_IDS.columnPinRight,
      label: 'Закрепить справа',
      surface: 'table-column-header',
      canExecute: context => context.pinState !== 'right' && hasTargetMethod(context, 'setColumnPin'),
      execute: context => executeSetColumnPin(context, 'right'),
    },
    {
      id: TABLE_RUNTIME_COMMAND_IDS.columnUnpin,
      label: 'Открепить',
      surface: 'table-column-header',
      canExecute: context => context.pinState !== 'none' && hasTargetMethod(context, 'setColumnPin'),
      execute: context => executeSetColumnPin(context, 'none'),
    },
    {
      id: TABLE_RUNTIME_COMMAND_IDS.sortSetColumnAsc,
      label: 'Сортировать по возрастанию',
      surface: 'table-column-header',
      canExecute: context => canChangeColumnSort(context) && hasTargetMethod(context, 'setColumnSort'),
      execute: context => executeSetColumnSort(context, 'asc'),
    },
    {
      id: TABLE_RUNTIME_COMMAND_IDS.sortSetColumnDesc,
      label: 'Сортировать по убыванию',
      surface: 'table-column-header',
      canExecute: context => canChangeColumnSort(context) && hasTargetMethod(context, 'setColumnSort'),
      execute: context => executeSetColumnSort(context, 'desc'),
    },
    {
      id: TABLE_RUNTIME_COMMAND_IDS.sortClearColumn,
      label: 'Сбросить сортировку колонки',
      surface: 'table-column-header',
      canExecute: context => canChangeColumnSort(context) && context.sortState.active && hasTargetMethod(context, 'clearColumnSort'),
      execute: context => executeClearColumnSort(context),
    },
    {
      id: TABLE_RUNTIME_COMMAND_IDS.sortClearAll,
      label: 'Сбросить все сортировки',
      surface: 'table-column-header',
      canExecute: context => canChangeSort(context) && context.activeSortCount > 0 && hasTargetMethod(context, 'clearAllSort'),
      execute: context => executeClearAllSort(context),
    },
  ]
}

function canChangeColumnSort(context: TableColumnCommandContext): boolean {
  return context.sortable && canChangeSort(context)
}

function canChangeSort(context: TableColumnCommandContext): boolean {
  return context.sortMode !== 'disabled' && context.sortMode !== 'fixed'
}

function hasTargetMethod(context: TableColumnCommandContext, method: TableTargetMethodName): boolean {
  return typeof context.target?.[method] === 'function'
}

async function executeSetColumnPin(context: TableColumnCommandContext, side: TableColumnPinSide): Promise<void> {
  await requireTargetMethod(context, 'setColumnPin')(context.columnKey, side)
}

async function executeSetColumnSort(context: TableColumnCommandContext, direction: TableSortDirection): Promise<void> {
  await requireTargetMethod(context, 'setColumnSort')(context.columnKey, direction)
}

async function executeClearColumnSort(context: TableColumnCommandContext): Promise<void> {
  await requireTargetMethod(context, 'clearColumnSort')(context.columnKey)
}

async function executeClearAllSort(context: TableColumnCommandContext): Promise<void> {
  await requireTargetMethod(context, 'clearAllSort')()
}

function requireTargetMethod<TMethod extends TableTargetMethodName>(
  context: TableColumnCommandContext,
  method: TMethod,
): NonNullable<TableRuntimeCommandTarget[TMethod]> {
  const fn = context.target?.[method]
  if (typeof fn !== 'function') {
    throw new Error(`[TableRuntimeCommands] target does not implement "${method}".`)
  }

  return fn as NonNullable<TableRuntimeCommandTarget[TMethod]>
}
