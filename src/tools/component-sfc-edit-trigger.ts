import type {
  ComponentSFCEditTrigger,
  ComponentSFCEditTriggerEvent,
  ComponentSFCEditTriggerHeldKeys,
  ComponentSFCEditTriggerModifiers,
  ComponentSFCEditTriggerPlatform,
} from '@/domain/types/component/sfc/ir.types'

/** Нормализует публичное значение edit-on в список валидных trigger descriptors. */
export function normalizeComponentSFCEditTriggers(value: unknown): ComponentSFCEditTrigger[] {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((item): ComponentSFCEditTrigger[] => {
    if (typeof item === 'string' && item.trim()) return [{ event: item.trim() }]
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []

    const source = item as Record<string, unknown>
    const event = String(source.event ?? '').trim()
    if (!event) return []

    const key = normalizeStringList(source.key)
    const code = normalizeStringList(source.code)
    const held = normalizeHeldKeys(source.held)
    const modifiers = normalizeModifiers(source.modifiers)
    return [{
      event,
      ...(key ? { key } : {}),
      ...(code ? { code } : {}),
      ...(held ? { held } : {}),
      ...(modifiers ? { modifiers } : {}),
      ...(typeof source.repeat === 'boolean' ? { repeat: source.repeat } : {}),
      ...(typeof source.composing === 'boolean' ? { composing: source.composing } : {}),
      ...(Number.isInteger(source.button) ? { button: Number(source.button) } : {}),
      stop: source.stop === true,
      prevent: source.prevent === true,
      self: source.self === true,
    }]
  })
}

/** Проверяет один нормализованный trigger без зависимости от DOM и конкретного renderer-а. */
export function matchesComponentSFCEditTrigger(
  trigger: ComponentSFCEditTrigger,
  event: ComponentSFCEditTriggerEvent,
  platform: ComponentSFCEditTriggerPlatform,
): boolean {
  if (trigger.self && !event.targetIsCurrentTarget) return false
  if (trigger.key?.length && !matchesKey(trigger.key, event.key)) return false
  if (trigger.code?.length && (!event.code || !trigger.code.includes(event.code))) return false
  if (trigger.repeat !== undefined && trigger.repeat !== event.repeat) return false
  if (trigger.composing !== undefined && trigger.composing !== event.composing) return false
  if (trigger.button != null && trigger.button !== event.button) return false
  if (!matchesHeldKeys(trigger.held, event.held)) return false
  return matchesModifiers(trigger.modifiers, event, platform)
}

/** Приводит browser platform label к стабильным значениям edit-on контракта. */
export function resolveComponentSFCEditTriggerPlatform(value: unknown): ComponentSFCEditTriggerPlatform {
  const platform = String(value ?? '').toLowerCase()
  if (platform.includes('mac') || platform.includes('darwin') || platform.includes('iphone') || platform.includes('ipad')) return 'macos'
  if (platform.includes('win')) return 'windows'
  if (platform.includes('linux') || platform.includes('x11') || platform.includes('cros')) return 'linux'
  return 'unknown'
}

function normalizeStringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  const result = [...new Set(values.map(item => String(item).trim()).filter(Boolean))]
  return result.length ? result : undefined
}

function normalizeHeldKeys(value: unknown): ComponentSFCEditTriggerHeldKeys | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const key = normalizeStringList(source.key)
  const code = normalizeStringList(source.code)
  const match = source.match === 'any' ? 'any' : source.match === 'all' ? 'all' : undefined
  const result: ComponentSFCEditTriggerHeldKeys = {
    ...(key ? { key } : {}),
    ...(code ? { code } : {}),
    ...(match ? { match } : {}),
    ...(typeof source.exact === 'boolean' ? { exact: source.exact } : {}),
  }
  return Object.keys(result).length ? result : undefined
}

function normalizeModifiers(value: unknown): ComponentSFCEditTriggerModifiers | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const result: ComponentSFCEditTriggerModifiers = {}
  for (const name of ['ctrl', 'shift', 'alt', 'meta', 'mod', 'altGraph', 'exact'] as const) {
    if (typeof source[name] === 'boolean') result[name] = source[name]
  }
  return Object.keys(result).length ? result : undefined
}

function matchesKey(expected: string[], actual: string | undefined): boolean {
  if (!actual) return false
  const normalized = actual.toLowerCase()
  return expected.some(key => key.toLowerCase() === normalized)
}

function matchesHeldKeys(
  expected: ComponentSFCEditTriggerHeldKeys | undefined,
  actual: ComponentSFCEditTriggerEvent['held'],
): boolean {
  if (!expected) return true
  const held = actual ?? { key: [], code: [] }
  const match = expected.match ?? 'all'

  if (expected.key?.length && !matchesHeldList(expected.key, held.key, match, value => value.toLowerCase())) return false
  if (expected.code?.length && !matchesHeldList(expected.code, held.code, match, value => value)) return false
  if (!expected.exact) return true

  if (expected.key?.length && hasUnexpectedHeldKey(expected.key, held.key, value => value.toLowerCase())) return false
  if (expected.code?.length && hasUnexpectedHeldKey(expected.code, held.code, value => value)) return false
  if (!expected.key?.length && !expected.code?.length && (held.key.length > 0 || held.code.length > 0)) return false
  return true
}

function matchesHeldList(
  expected: string[],
  actual: string[],
  match: 'all' | 'any',
  normalize: (value: string) => string,
): boolean {
  const active = new Set(actual.map(normalize))
  return match === 'any'
    ? expected.some(value => active.has(normalize(value)))
    : expected.every(value => active.has(normalize(value)))
}

function hasUnexpectedHeldKey(
  expected: string[],
  actual: string[],
  normalize: (value: string) => string,
): boolean {
  const allowed = new Set(expected.map(normalize))
  return actual.some(value => !allowed.has(normalize(value)))
}

function matchesModifiers(
  expected: ComponentSFCEditTriggerModifiers | undefined,
  event: ComponentSFCEditTriggerEvent,
  platform: ComponentSFCEditTriggerPlatform,
): boolean {
  if (!expected) return true
  const actual = event.modifiers

  for (const name of ['ctrl', 'shift', 'alt', 'meta'] as const) {
    if (expected[name] !== undefined && expected[name] !== actual[name]) return false
  }
  if (expected.altGraph !== undefined && expected.altGraph !== actual.altGraph) return false
  if (expected.mod !== undefined && expected.mod !== primaryModifierActive(actual, platform)) return false
  if (!expected.exact) return true

  const primary = platform === 'macos' ? 'meta' : platform === 'windows' || platform === 'linux' ? 'ctrl' : null
  const altGraphCoversCtrlAlt = expected.altGraph === true && actual.altGraph
  for (const name of ['ctrl', 'shift', 'alt', 'meta'] as const) {
    const coveredByMod = expected.mod !== undefined && (primary === name || primary === null && (name === 'ctrl' || name === 'meta'))
    const coveredByAltGraph = altGraphCoversCtrlAlt && (name === 'ctrl' || name === 'alt')
    if (expected[name] === undefined && !coveredByMod && !coveredByAltGraph && actual[name]) return false
  }
  return true
}

function primaryModifierActive(
  modifiers: ComponentSFCEditTriggerEvent['modifiers'],
  platform: ComponentSFCEditTriggerPlatform,
): boolean {
  if (platform === 'macos') return modifiers.meta
  if (platform === 'windows' || platform === 'linux') return modifiers.ctrl
  return modifiers.ctrl || modifiers.meta
}
