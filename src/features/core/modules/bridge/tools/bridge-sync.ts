import type { BridgeInspectionSnapshot, BridgeInspectionUpdate, BridgeStreamEvent } from '@/features/core/modules/bridge/domain/bridge-sync.type'
import type { EndgeCommand } from '@/features/core/modules/commands/domain/commands.types'
import type { ContextEvent } from '@/features/core/modules/context/domain/context-events.types'
import type { RuntimeStatusChange } from '@/features/core/modules/runtime/domain/runtime-inspection.types'
import { readRuntimeInspectionSnapshot, readRuntimeRenderInspection } from '@/features/core/modules/runtime/tools/runtime-inspection'

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Проверяет границу снимка; сам Domain валидируется штатным импортом Core. */
export function readBridgeInspectionSnapshot(value: unknown): BridgeInspectionSnapshot {
  const source = record(value)
  const snapshot = record(source?.snapshot)
  if (!source || !snapshot || snapshot.format !== 'endge-diagnostics-snapshot' || snapshot.version !== 2
    || !Number.isSafeInteger(source.sequence) || Number(source.sequence) < 0) {
    throw new Error('[Endge Bridge] Invalid inspection snapshot')
  }
  return source as unknown as BridgeInspectionSnapshot
}

/** Проверяет метаданные потока до помещения события в ограниченный буфер. */
export function readBridgeStreamEvent(value: unknown): BridgeStreamEvent {
  const source = record(value)
  const event = record(source?.event)
  if (!source || !Number.isSafeInteger(source.sequence) || Number(source.sequence) < 1
    || !event || typeof event.name !== 'string' || !event.name || event.name.length > 160
    || !Number.isSafeInteger(event.sequence) || Number(event.sequence) < 1
    || typeof event.at !== 'number' || !Number.isFinite(event.at) || !Object.hasOwn(event, 'payload')) {
    throw new Error('[Endge Bridge] Invalid event envelope')
  }
  return source as unknown as BridgeStreamEvent
}

/** Распознаёт только существующие Context events и проверяет оба значения перед применением. */
export function readBridgeContextEvent(event: BridgeStreamEvent['event']): ContextEvent | null {
  const fields = {
    'context:workspace-changed': 'workspace',
    'context:tenant-changed': 'tenant',
    'context:project-changed': 'project',
    'context:environment-changed': 'environment',
    'context:user-changed': 'user',
    'context:locale-changed': 'locale',
    'context:theme-changed': 'theme',
    'context:timezone-changed': 'timezone',
    'context:data-mode-changed': 'dataMode',
  } as const satisfies Record<ContextEvent['name'], string>
  if (!Object.hasOwn(fields, event.name)) {
    return null
  }
  const payload = record(event.payload)
  if (!payload || !Object.hasOwn(payload, 'previous') || !Object.hasOwn(payload, 'value')) {
    throw new Error('[Endge Bridge] Invalid context event payload')
  }
  for (const value of [payload.previous, payload.value]) {
    const valid = event.name === 'context:data-mode-changed'
      ? value === 'live' || value === 'mock'
      : typeof value === 'string' || (event.name === 'context:workspace-changed' && value === null)
    if (!valid) {
      throw new Error(`[Endge Bridge] Invalid payload for ${event.name}`)
    }
  }
  return { name: event.name, payload } as unknown as ContextEvent
}

/** Проверяет wire envelope; имя команды и payload дополнительно проверяет локальный реестр обработчиков. */
export function readBridgeCommand(value: unknown): EndgeCommand {
  const source = record(value)
  if (!source || typeof source.type !== 'string' || !source.type || source.type.length > 160
    || !Object.hasOwn(source, 'payload')) {
    throw new Error('[Endge Bridge] Invalid command envelope')
  }
  return source as unknown as EndgeCommand
}

/** Проверяет крупный snapshot до буферизации в согласованном потоке. */
export function readBridgeInspectionUpdate(value: unknown): BridgeInspectionUpdate {
  const source = record(value)
  const update = record(source?.update)
  if (!source || !Number.isSafeInteger(source.sequence) || Number(source.sequence) < 1 || !update) {
    throw new Error('[Endge Bridge] Invalid inspection update')
  }
  if (update.kind === 'runtime') {
    readRuntimeInspectionSnapshot(update.snapshot)
  }
  else if (update.kind === 'data') {
    if (!Object.hasOwn(update, 'data') || typeof update.generatedAt !== 'number' || !Number.isFinite(update.generatedAt) || update.generatedAt < 0) {
      throw new Error('[Endge Bridge] Invalid inspection data')
    }
    if (update.render !== undefined) {
      readRuntimeRenderInspection(update.render)
    }
  }
  else if (update.kind !== 'data-error' || typeof update.message !== 'string' || update.message.length > 1024) {
    throw new Error('[Endge Bridge] Invalid inspection update kind')
  }
  return source as unknown as BridgeInspectionUpdate
}

/** Runtime facts применяются только после проверки статусов и адреса host. */
export function readBridgeRuntimeEvent(event: BridgeStreamEvent['event']): RuntimeStatusChange | null {
  if (event.name !== 'runtime:host-status-changed') {
    return null
  }
  const payload = record(event.payload)
  const statuses = ['created', 'mounted', 'running', 'active', 'pausing', 'paused', 'stopping', 'stopped', 'unmounted', 'destroyed', 'error']
  if (!payload || typeof payload.id !== 'string' || !payload.id || !statuses.includes(String(payload.previous)) || !statuses.includes(String(payload.value))) {
    throw new Error('[Endge Bridge] Invalid runtime event')
  }
  return payload as unknown as RuntimeStatusChange
}
