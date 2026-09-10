import type { BridgeInspectionSnapshot, BridgeStreamEvent } from '@/features/core/modules/bridge/domain/bridge-sync.type'
import type { EndgeCommand } from '@/features/core/modules/commands/domain/commands.types'
import type { ContextEvent } from '@/features/core/modules/context/domain/context-events.types'

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
