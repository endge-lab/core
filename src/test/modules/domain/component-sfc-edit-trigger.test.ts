import type { ComponentSFCEditTriggerEvent } from '@/modules/domain/types/component/sfc/ir.types'

import { describe, expect, it } from 'vitest'
import {
  matchesComponentSFCEditTrigger,
  normalizeComponentSFCEditTriggers,
  resolveComponentSFCEditTriggerPlatform,
} from '@/modules/domain/component/component-sfc-edit-trigger'

const baseEvent: ComponentSFCEditTriggerEvent = {
  key: 'e',
  code: 'KeyE',
  repeat: false,
  composing: false,
  targetIsCurrentTarget: true,
  held: { key: [], code: [] },
  modifiers: {
    ctrl: false,
    shift: false,
    alt: false,
    meta: false,
    altGraph: false,
  },
}

describe('триггер редактирования Component SFC', () => {
  it('нормализует фильтры клавиатуры и явно ложные состояния модификаторов', () => {
    expect(normalizeComponentSFCEditTriggers({
      event: 'keydown',
      key: 'e',
      code: ['KeyE'],
      held: { code: ['KeyW', 'KeyR'], match: 'all', exact: true },
      modifiers: { mod: true, shift: false, exact: true },
      repeat: false,
      composing: false,
    })).toEqual([{
      event: 'keydown',
      key: ['e'],
      code: ['KeyE'],
      held: { code: ['KeyW', 'KeyR'], match: 'all', exact: true },
      modifiers: { shift: false, mod: true, exact: true },
      repeat: false,
      composing: false,
      stop: false,
      prevent: false,
      self: false,
    }])
  })

  it('сопоставляет mod с Control в Windows/Linux и с Meta в macOS', () => {
    const trigger = normalizeComponentSFCEditTriggers({
      event: 'keydown',
      key: ['e', 'r'],
      modifiers: { mod: true, exact: true },
    })[0]!

    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      modifiers: { ...baseEvent.modifiers, ctrl: true },
    }, 'windows')).toBe(true)
    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      modifiers: { ...baseEvent.modifiers, meta: true },
    }, 'macos')).toBe(true)
    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      modifiers: { ...baseEvent.modifiers, ctrl: true },
    }, 'macos')).toBe(false)
  })

  it('использует exact для отклонения неуказанных физических модификаторов', () => {
    const trigger = normalizeComponentSFCEditTriggers({
      event: 'keydown',
      key: ['e'],
      modifiers: { ctrl: true, exact: true },
    })[0]!

    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      modifiers: { ...baseEvent.modifiers, ctrl: true, shift: true },
    }, 'windows')).toBe(false)
  })

  it('поддерживает независимый от раскладки code и состояние события клавиатуры', () => {
    const trigger = normalizeComponentSFCEditTriggers({
      event: 'keydown',
      code: ['KeyE'],
      repeat: false,
      composing: false,
    })[0]!

    expect(matchesComponentSFCEditTrigger(trigger, { ...baseEvent, key: 'у' }, 'linux')).toBe(true)
    expect(matchesComponentSFCEditTrigger(trigger, { ...baseEvent, repeat: true }, 'linux')).toBe(false)
    expect(matchesComponentSFCEditTrigger(trigger, { ...baseEvent, composing: true }, 'linux')).toBe(false)
  })

  it('отличает сообщённое состояние AltGraph от явной комбинации Ctrl+Alt', () => {
    const trigger = normalizeComponentSFCEditTriggers({
      event: 'keydown',
      code: ['KeyE'],
      modifiers: { ctrl: true, alt: true, altGraph: false, exact: true },
    })[0]!

    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      modifiers: { ...baseEvent.modifiers, ctrl: true, alt: true },
    }, 'linux')).toBe(true)
    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      modifiers: { ...baseEvent.modifiers, ctrl: true, alt: true, altGraph: true },
    }, 'linux')).toBe(false)
  })

  it('по умолчанию сопоставляет все удерживаемые клавиши и отклоняет лишние в режиме exact', () => {
    const trigger = normalizeComponentSFCEditTriggers({
      event: 'contextmenu',
      held: { code: ['KeyW', 'KeyE'], exact: true },
    })[0]!

    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      held: { key: ['w', 'e'], code: ['KeyW', 'KeyE'] },
    }, 'macos')).toBe(true)
    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      held: { key: ['w', 'e', 'r'], code: ['KeyW', 'KeyE', 'KeyR'] },
    }, 'macos')).toBe(false)
  })

  it('поддерживает любую удерживаемую клавишу без требования полного списка', () => {
    const trigger = normalizeComponentSFCEditTriggers({
      event: 'contextmenu',
      held: { key: ['w', 'e'], match: 'any' },
    })[0]!

    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      held: { key: ['E'], code: ['KeyE'] },
    }, 'macos')).toBe(true)
    expect(matchesComponentSFCEditTrigger(trigger, {
      ...baseEvent,
      held: { key: ['r'], code: ['KeyR'] },
    }, 'macos')).toBe(false)
  })

  it('нормализует распространённые названия браузерных платформ', () => {
    expect(resolveComponentSFCEditTriggerPlatform('macOS')).toBe('macos')
    expect(resolveComponentSFCEditTriggerPlatform('Darwin')).toBe('macos')
    expect(resolveComponentSFCEditTriggerPlatform('Win32')).toBe('windows')
    expect(resolveComponentSFCEditTriggerPlatform('Linux x86_64')).toBe('linux')
    expect(resolveComponentSFCEditTriggerPlatform(undefined)).toBe('unknown')
  })
})
