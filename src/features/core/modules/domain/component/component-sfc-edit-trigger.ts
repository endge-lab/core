import type {
  ComponentSFCInteractionKeyboardCondition,
  ComponentSFCInteractionTrigger,
  ComponentSFCInteractionTriggerActivation,
  ComponentSFCInteractionTriggerEvent,
  ComponentSFCInteractionTriggerHeldKeys,
  ComponentSFCInteractionTriggerModifiers,
  ComponentSFCInteractionTriggerPlatform,
  ComponentSFCInteractionTriggerSequence,
  ComponentSFCInteractionTriggerSet,
} from '@/features/core/modules/domain/types/component/sfc/ir.types'

export const DEFAULT_COMPONENT_SFC_INTERACTION_SEQUENCE_INTERVAL_MS = 1_000

export type ComponentSFCInteractionTriggerActivationMatch
  = | { status: 'none' }
    | {
      status: 'progress' | 'complete'
      trigger: ComponentSFCInteractionTrigger
      stepIndex: number
      triggerIndex: number
    }

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

/** Нормализует legacy TriggerSet или последовательность, не меняя форму обычного набора. */
export function normalizeComponentSFCInteractionTriggerActivation(
  value: unknown,
): ComponentSFCInteractionTriggerActivation {
  if (!isRecord(value) || value.mode !== 'sequence') {
    return normalizeComponentSFCInteractionTriggers(value)
  }

  const steps = Array.isArray(value.steps)
    ? value.steps.flatMap((item, index) => {
        if (!isRecord(item)) {
          return []
        }
        const maxIntervalMs = normalizeSequenceInterval(item.maxIntervalMs)
        return [{
          triggerSet: normalizeComponentSFCInteractionTriggers(item.triggerSet),
          ...(index > 0 ? { maxIntervalMs } : {}),
        }]
      })
    : []
  return { mode: 'sequence', steps }
}

/** Проверяет, содержит ли активация хотя бы один исполнимый TriggerSet. */
export function hasComponentSFCInteractionTriggerActivation(
  activation: ComponentSFCInteractionTriggerActivation,
): boolean {
  return Array.isArray(activation)
    ? activation.length > 0
    : activation.steps.length > 0 && activation.steps.every(step => step.triggerSet.length > 0)
}

/** Stateful matcher последовательностей, общий для runtime-владельцев и platform adapters. */
export class ComponentSFCInteractionTriggerActivationMatcher {
  private readonly _activation: ComponentSFCInteractionTriggerActivation
  private readonly _onceTriggered = new Set<string>()
  private _matchedOnce: string[] = []
  private _nextStepIndex = 0
  private _deadline = Number.POSITIVE_INFINITY

  public constructor(value: unknown) {
    this._activation = normalizeComponentSFCInteractionTriggerActivation(value)
  }

  /** Принимает очередное событие и возвращает прогресс либо завершение активации. */
  public match(
    eventName: string,
    event: ComponentSFCInteractionTriggerEvent,
    platform: ComponentSFCInteractionTriggerPlatform,
    occurredAt = Date.now(),
  ): ComponentSFCInteractionTriggerActivationMatch {
    if (Array.isArray(this._activation)) {
      return this._matchSet(this._activation, 0, eventName, event, platform, true)
    }
    return this._matchSequence(this._activation, eventName, event, platform, occurredAt)
  }

  /** Сбрасывает transient progress и once-состояние при lifecycle/configuration reset. */
  public reset(): void {
    this._onceTriggered.clear()
    this._resetProgress()
  }

  private _matchSequence(
    sequence: ComponentSFCInteractionTriggerSequence,
    eventName: string,
    event: ComponentSFCInteractionTriggerEvent,
    platform: ComponentSFCInteractionTriggerPlatform,
    occurredAt: number,
  ): ComponentSFCInteractionTriggerActivationMatch {
    if (sequence.steps.length === 0) {
      return { status: 'none' }
    }
    if (this._nextStepIndex > 0 && occurredAt > this._deadline) {
      this._resetProgress()
    }

    const stepIndex = this._nextStepIndex
    const step = sequence.steps[stepIndex]
    const match = step
      ? this._matchSet(step.triggerSet, stepIndex, eventName, event, platform, false)
      : { status: 'none' as const }
    if (match.status !== 'none') {
      const onceKey = this._onceKey(match.stepIndex, match.triggerIndex)
      if (match.trigger.once) {
        this._matchedOnce.push(onceKey)
      }
      if (stepIndex === sequence.steps.length - 1) {
        for (const key of this._matchedOnce) {
          this._onceTriggered.add(key)
        }
        this._resetProgress()
        return { ...match, status: 'complete' }
      }

      this._nextStepIndex += 1
      const nextStep = sequence.steps[this._nextStepIndex]
      this._deadline = occurredAt + (nextStep?.maxIntervalMs
        ?? DEFAULT_COMPONENT_SFC_INTERACTION_SEQUENCE_INTERVAL_MS)
      return { ...match, status: 'progress' }
    }

    if (!step || !this._shouldResetSequence(step.triggerSet, eventName, event)) {
      return { status: 'none' }
    }

    this._resetProgress()
    const restarted = this._matchSet(sequence.steps[0]?.triggerSet ?? [], 0, eventName, event, platform, false)
    if (restarted.status === 'none') {
      return restarted
    }
    if (sequence.steps.length === 1) {
      if (restarted.trigger.once) {
        this._onceTriggered.add(this._onceKey(0, restarted.triggerIndex))
      }
      return { ...restarted, status: 'complete' }
    }
    if (restarted.trigger.once) {
      this._matchedOnce.push(this._onceKey(0, restarted.triggerIndex))
    }
    this._nextStepIndex = 1
    this._deadline = occurredAt + (sequence.steps[1]?.maxIntervalMs
      ?? DEFAULT_COMPONENT_SFC_INTERACTION_SEQUENCE_INTERVAL_MS)
    return { ...restarted, status: 'progress' }
  }

  private _matchSet(
    triggerSet: ComponentSFCInteractionTriggerSet,
    stepIndex: number,
    eventName: string,
    event: ComponentSFCInteractionTriggerEvent,
    platform: ComponentSFCInteractionTriggerPlatform,
    complete: boolean,
  ): ComponentSFCInteractionTriggerActivationMatch {
    const triggerIndex = triggerSet.findIndex((trigger, index) => (
      !this._onceTriggered.has(this._onceKey(stepIndex, index))
      && trigger.event === eventName
      && matchesComponentSFCInteractionTrigger(trigger, event, platform)
    ))
    if (triggerIndex < 0) {
      return { status: 'none' }
    }
    const trigger = triggerSet[triggerIndex]!
    if (complete && trigger.once) {
      this._onceTriggered.add(this._onceKey(stepIndex, triggerIndex))
    }
    return { status: complete ? 'complete' : 'progress', trigger, stepIndex, triggerIndex }
  }

  private _shouldResetSequence(
    triggerSet: ComponentSFCInteractionTriggerSet,
    eventName: string,
    event: ComponentSFCInteractionTriggerEvent,
  ): boolean {
    if (event.repeat || event.composing) {
      return false
    }
    if (!triggerSet.some(trigger => trigger.event === eventName)) {
      return false
    }
    return !isModifierEvent(event)
  }

  private _resetProgress(): void {
    this._matchedOnce = []
    this._nextStepIndex = 0
    this._deadline = Number.POSITIVE_INFINITY
  }

  private _onceKey(stepIndex: number, triggerIndex: number): string {
    return `${stepIndex}:${triggerIndex}`
  }
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

function normalizeSequenceInterval(value: unknown): number {
  const interval = Number(value)
  return Number.isFinite(interval) && interval > 0
    ? Math.min(60_000, Math.round(interval))
    : DEFAULT_COMPONENT_SFC_INTERACTION_SEQUENCE_INTERVAL_MS
}

function isModifierEvent(event: ComponentSFCInteractionTriggerEvent): boolean {
  return ['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(event.key ?? '')
    || /^(?:Shift|Control|Alt|Meta)(?:Left|Right)$/.test(event.code ?? '')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
