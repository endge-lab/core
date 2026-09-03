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

describe('component SFC edit trigger', () => {
  it('normalizes keyboard filters and explicit false modifier states', () => {
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

  it('maps mod to Control on Windows/Linux and Meta on macOS', () => {
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

  it('uses exact to reject unmentioned physical modifiers', () => {
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

  it('supports layout-independent code and keyboard event state', () => {
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

  it('distinguishes a reported AltGraph state from an explicit Ctrl+Alt combination', () => {
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

  it('matches all held keys by default and rejects extras in exact mode', () => {
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

  it('supports any held key without requiring the whole list', () => {
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

  it('normalizes common browser platform labels', () => {
    expect(resolveComponentSFCEditTriggerPlatform('macOS')).toBe('macos')
    expect(resolveComponentSFCEditTriggerPlatform('Darwin')).toBe('macos')
    expect(resolveComponentSFCEditTriggerPlatform('Win32')).toBe('windows')
    expect(resolveComponentSFCEditTriggerPlatform('Linux x86_64')).toBe('linux')
    expect(resolveComponentSFCEditTriggerPlatform(undefined)).toBe('unknown')
  })
})
