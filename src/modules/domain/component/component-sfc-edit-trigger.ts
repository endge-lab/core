import type {
  ComponentSFCInteractionKeyboardCondition,
  ComponentSFCInteractionTrigger,
  ComponentSFCInteractionTriggerEvent,
  ComponentSFCInteractionTriggerHeldKeys,
  ComponentSFCInteractionTriggerModifiers,
  ComponentSFCInteractionTriggerPlatform,
} from '@/modules/domain/types/component/sfc/ir.types'

/** Нормализует общее значение trigger `edit-on` или `on`. */
export function normalizeComponentSFCInteractionTriggers(value: unknown): ComponentSFCInteractionTrigger[] {
  const values = Array.isArray(value) ? value : [value]
  return values.flatMap((item): ComponentSFCInteractionTrigger[] => {
    if (typeof item === 'string' && item.trim()) {
      return [{ event: item.trim() }]
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return []
    }

    const source = item as Record<string, unknown>
    const event = String(source.event ?? '').trim()
    if (!event) {
      return []
    }

    const key = normalizeStringList(source.key)
    const code = normalizeStringList(source.code)
    const keyboard = normalizeComponentSFCInteractionKeyboardCondition(source)
    return [{
      event,
      ...(key ? { key } : {}),
      ...(code ? { code } : {}),
      ...keyboard,
      ...(typeof source.repeat === 'boolean' ? { repeat: source.repeat } : {}),
      ...(typeof source.composing === 'boolean' ? { composing: source.composing } : {}),
      ...(Number.isInteger(source.button) ? { button: Number(source.button) } : {}),
      stop: source.stop === true,
      prevent: source.prevent === true,
      self: source.self === true,
      ...(source.once === true ? { once: true } : {}),
      ...(source.capture === true ? { capture: true } : {}),
      ...(source.passive === true ? { passive: true } : {}),
    }]
  })
}

/** Проверяет один нормализованный trigger без зависимости от DOM и конкретного renderer-а. */
export function matchesComponentSFCInteractionTrigger(
  trigger: ComponentSFCInteractionTrigger,
  event: ComponentSFCInteractionTriggerEvent,
  platform: ComponentSFCInteractionTriggerPlatform,
): boolean {
  if (trigger.self && !event.targetIsCurrentTarget) {
    return false
  }
  if (trigger.key?.length && !matchesKey(trigger.key, event.key)) {
    return false
  }
  if (trigger.code?.length && (!event.code || !trigger.code.includes(event.code))) {
    return false
  }
  if (trigger.repeat !== undefined && trigger.repeat !== event.repeat) {
    return false
  }
  if (trigger.composing !== undefined && trigger.composing !== event.composing) {
    return false
  }
  if (trigger.button != null && trigger.button !== event.button) {
    return false
  }
  return matchesComponentSFCInteractionKeyboardCondition(trigger, event, platform)
}

/** Приводит browser platform label к стабильным значениям edit-on контракта. */
export function resolveComponentSFCInteractionTriggerPlatform(value: unknown): ComponentSFCInteractionTriggerPlatform {
  const platform = String(value ?? '').toLowerCase()
  if (platform.includes('mac') || platform.includes('darwin') || platform.includes('iphone') || platform.includes('ipad')) {
    return 'macos'
  }
  if (platform.includes('win')) {
    return 'windows'
  }
  if (platform.includes('linux') || platform.includes('x11') || platform.includes('cros')) {
    return 'linux'
  }
  return 'unknown'
}

function normalizeStringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : value == null ? [] : [value]
  const result = [...new Set(values.map(item => String(item).trim()).filter(Boolean))]
  return result.length ? result : undefined
}

export function normalizeComponentSFCInteractionHeldKeys(value: unknown): ComponentSFCInteractionTriggerHeldKeys | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const source = value as Record<string, unknown>
  const key = normalizeStringList(source.key)
  const code = normalizeStringList(source.code)
  const match = source.match === 'any' ? 'any' : source.match === 'all' ? 'all' : undefined
  const result: ComponentSFCInteractionTriggerHeldKeys = {
    ...(key ? { key } : {}),
    ...(code ? { code } : {}),
    ...(match ? { match } : {}),
    ...(typeof source.exact === 'boolean' ? { exact: source.exact } : {}),
  }
  return Object.keys(result).length ? result : undefined
}

/** Нормализует переиспользуемое условие текущего состояния клавиатуры. */
export function normalizeComponentSFCInteractionKeyboardCondition(value: unknown): ComponentSFCInteractionKeyboardCondition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const source = value as Record<string, unknown>
  const modifiers = normalizeComponentSFCInteractionModifiers(source.modifiers)
  const held = normalizeComponentSFCInteractionHeldKeys(source.held)
  if (!modifiers && !held) {
    return undefined
  }
  return {
    ...(modifiers ? { modifiers } : {}),
    ...(held ? { held } : {}),
  }
}

export function normalizeComponentSFCInteractionModifiers(value: unknown): ComponentSFCInteractionTriggerModifiers | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const source = value as Record<string, unknown>
  const result: ComponentSFCInteractionTriggerModifiers = {}
  for (const name of ['ctrl', 'shift', 'alt', 'meta', 'mod', 'altGraph', 'exact'] as const) {
    if (typeof source[name] === 'boolean') {
      result[name] = source[name]
    }
  }
  return Object.keys(result).length ? result : undefined
}

function matchesKey(expected: string[], actual: string | undefined): boolean {
  if (!actual) {
    return false
  }
  const normalized = actual.toLowerCase()
  return expected.some(key => key.toLowerCase() === normalized)
}

export function matchesComponentSFCInteractionHeldKeys(
  expected: ComponentSFCInteractionTriggerHeldKeys | undefined,
  actual: ComponentSFCInteractionTriggerEvent['held'],
): boolean {
  if (!expected) {
    return true
  }
  const held = actual ?? { key: [], code: [] }
  const match = expected.match ?? 'all'

  if (expected.key?.length && !matchesHeldList(expected.key, held.key, match, value => value.toLowerCase())) {
    return false
  }
  if (expected.code?.length && !matchesHeldList(expected.code, held.code, match, value => value)) {
    return false
  }
  if (!expected.exact) {
    return true
  }

  if (expected.key?.length && hasUnexpectedHeldKey(expected.key, held.key, value => value.toLowerCase())) {
    return false
  }
  if (expected.code?.length && hasUnexpectedHeldKey(expected.code, held.code, value => value)) {
    return false
  }
  if (!expected.key?.length && !expected.code?.length && (held.key.length > 0 || held.code.length > 0)) {
    return false
  }
  return true
}

/** Проверяет модификаторы и обычные удерживаемые клавиши по одному snapshot клавиатуры. */
export function matchesComponentSFCInteractionKeyboardCondition(
  expected: ComponentSFCInteractionKeyboardCondition | undefined,
  actual: Pick<ComponentSFCInteractionTriggerEvent, 'held' | 'modifiers'>,
  platform: ComponentSFCInteractionTriggerPlatform,
): boolean {
  if (!expected) {
    return true
  }
  return matchesComponentSFCInteractionHeldKeys(expected.held, actual.held)
    && matchesComponentSFCInteractionModifiers(expected.modifiers, actual.modifiers, platform)
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

export function matchesComponentSFCInteractionModifiers(
  expected: ComponentSFCInteractionTriggerModifiers | undefined,
  actual: ComponentSFCInteractionTriggerEvent['modifiers'],
  platform: ComponentSFCInteractionTriggerPlatform,
): boolean {
  if (!expected) {
    return true
  }

  for (const name of ['ctrl', 'shift', 'alt', 'meta'] as const) {
    if (expected[name] !== undefined && expected[name] !== actual[name]) {
      return false
    }
  }
  if (expected.altGraph !== undefined && expected.altGraph !== actual.altGraph) {
    return false
  }
  if (expected.mod !== undefined && expected.mod !== primaryModifierActive(actual, platform)) {
    return false
  }
  if (!expected.exact) {
    return true
  }

  const primary = platform === 'macos' ? 'meta' : (platform === 'windows' || platform === 'linux') ? 'ctrl' : null
  const altGraphCoversCtrlAlt = expected.altGraph === true && actual.altGraph
  for (const name of ['ctrl', 'shift', 'alt', 'meta'] as const) {
    const coveredByMod = expected.mod !== undefined && (primary === name || (primary === null && (name === 'ctrl' || name === 'meta')))
    const coveredByAltGraph = altGraphCoversCtrlAlt && (name === 'ctrl' || name === 'alt')
    if (expected[name] === undefined && !coveredByMod && !coveredByAltGraph && actual[name]) {
      return false
    }
  }
  return true
}

function primaryModifierActive(
  modifiers: ComponentSFCInteractionTriggerEvent['modifiers'],
  platform: ComponentSFCInteractionTriggerPlatform,
): boolean {
  if (platform === 'macos') {
    return modifiers.meta
  }
  if (platform === 'windows' || platform === 'linux') {
    return modifiers.ctrl
  }
  return modifiers.ctrl || modifiers.meta
}

/** Editable-обёртки для обратной совместимости. */
export const normalizeComponentSFCEditTriggers = normalizeComponentSFCInteractionTriggers
export const matchesComponentSFCEditTrigger = matchesComponentSFCInteractionTrigger
export const resolveComponentSFCEditTriggerPlatform = resolveComponentSFCInteractionTriggerPlatform
