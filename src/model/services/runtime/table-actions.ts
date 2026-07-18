import type {
  RuntimeAction,
  TableColumnActionContext,
  TableColumnPinSide,
  TableRuntimeActionTarget,
  TableSortDirection,
} from '@/domain/types/runtime/action.types'
import { TABLE_RUNTIME_ACTION_IDS } from '@/domain/types/runtime/action.types'

type TableTargetMethodName = keyof TableRuntimeActionTarget

/** Built-in Action providers implemented by a mounted Table target. */
export function createTableRuntimeActions(): RuntimeAction<TableColumnActionContext>[] {
  return [
    action(TABLE_RUNTIME_ACTION_IDS.columnPinLeft, context => canChangeColumnPin(context) && context.pinState !== 'left' && hasTargetMethod(context, 'setColumnPin'), context => executeSetColumnPin(context, 'left')),
    action(TABLE_RUNTIME_ACTION_IDS.columnPinRight, context => canChangeColumnPin(context) && context.pinState !== 'right' && hasTargetMethod(context, 'setColumnPin'), context => executeSetColumnPin(context, 'right')),
    action(TABLE_RUNTIME_ACTION_IDS.columnUnpin, context => canChangeColumnPin(context) && context.pinState !== 'none' && hasTargetMethod(context, 'setColumnPin'), context => executeSetColumnPin(context, 'none')),
    action(TABLE_RUNTIME_ACTION_IDS.columnResetPin, context => canChangeColumnPin(context) && context.pinState !== context.defaultPinState && hasTargetMethod(context, 'resetColumnPin'), executeResetColumnPin),
    action(TABLE_RUNTIME_ACTION_IDS.columnResetAllPins, context => canChangePin(context) && context.hasPinChanges && hasTargetMethod(context, 'resetAllPins'), executeResetAllPins),
    action(TABLE_RUNTIME_ACTION_IDS.sortSetColumnAsc, context => canChangeColumnSort(context) && hasTargetMethod(context, 'setColumnSort'), context => executeSetColumnSort(context, 'asc')),
    action(TABLE_RUNTIME_ACTION_IDS.sortSetColumnDesc, context => canChangeColumnSort(context) && hasTargetMethod(context, 'setColumnSort'), context => executeSetColumnSort(context, 'desc')),
    action(TABLE_RUNTIME_ACTION_IDS.sortClearColumn, context => canChangeColumnSort(context) && context.sortState.active && hasTargetMethod(context, 'clearColumnSort'), executeClearColumnSort),
    action(TABLE_RUNTIME_ACTION_IDS.sortClearAll, context => canChangeSort(context) && context.activeSortCount > 0 && hasTargetMethod(context, 'clearAllSort'), executeClearAllSort),
  ]
}

function action(
  id: string,
  canExecute: (context: TableColumnActionContext) => boolean,
  execute: (context: TableColumnActionContext) => void | Promise<void>,
): RuntimeAction<TableColumnActionContext> {
  return { id, label: id, surface: 'table-column-header', canExecute, execute }
}

function canChangeColumnSort(context: TableColumnActionContext): boolean {
  return context.sortable && canChangeSort(context)
}

function canChangeColumnPin(context: TableColumnActionContext): boolean {
  return context.pinnable && canChangePin(context)
}

function canChangePin(context: TableColumnActionContext): boolean {
  return context.pinMode !== 'disabled'
}

function canChangeSort(context: TableColumnActionContext): boolean {
  return context.sortMode !== 'disabled' && context.sortMode !== 'fixed'
}

function hasTargetMethod(context: TableColumnActionContext, method: TableTargetMethodName): boolean {
  return typeof context.target?.[method] === 'function'
}

async function executeSetColumnPin(context: TableColumnActionContext, side: TableColumnPinSide): Promise<void> {
  await requireTargetMethod(context, 'setColumnPin')(context.columnKey, side)
}

async function executeResetColumnPin(context: TableColumnActionContext): Promise<void> {
  await requireTargetMethod(context, 'resetColumnPin')(context.columnKey)
}

async function executeResetAllPins(context: TableColumnActionContext): Promise<void> {
  await requireTargetMethod(context, 'resetAllPins')()
}

async function executeSetColumnSort(context: TableColumnActionContext, direction: TableSortDirection): Promise<void> {
  await requireTargetMethod(context, 'setColumnSort')(context.columnKey, direction)
}

async function executeClearColumnSort(context: TableColumnActionContext): Promise<void> {
  await requireTargetMethod(context, 'clearColumnSort')(context.columnKey)
}

async function executeClearAllSort(context: TableColumnActionContext): Promise<void> {
  await requireTargetMethod(context, 'clearAllSort')()
}

function requireTargetMethod<TMethod extends TableTargetMethodName>(
  context: TableColumnActionContext,
  method: TMethod,
): NonNullable<TableRuntimeActionTarget[TMethod]> {
  const fn = context.target?.[method]
  if (typeof fn !== 'function')
    throw new Error(`[TableRuntimeActions] target does not implement "${method}".`)
  return fn as NonNullable<TableRuntimeActionTarget[TMethod]>
}
