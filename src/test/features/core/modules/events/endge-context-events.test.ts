import type { EndgePublishedEvent } from '@/features/core/modules/events/domain/events.types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import { EndgeEvents_Module } from '@/features/core/modules/events/EndgeEvents_Module'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('context publishes effective variable changes', () => {
  let context: EndgeContext_Module
  let records: EndgePublishedEvent[]

  beforeEach(() => {
    Endge.events.reset()
    Endge.configuration.reset()
    Endge.workspace.reset()
    records = []
    Endge.events.onAny(event => records.push(event))
    context = new EndgeContext_Module()
    context.configurePersistence({ context: 'disabled' })
  })

  afterEach(() => {
    Endge.events.reset()
    vi.restoreAllMocks()
  })

  it('does not publish constructor hydration and emits all nine distinct variables', () => {
    expect(records).toEqual([])
    context.setCurrentWorkspace('events-workspace')
    context.setCurrentTenant('events-tenant')
    context.setCurrentProject('events-project')
    context.setCurrentEnvironment('events-environment')
    context.setCurrentUser('events-user')
    context.setCurrentLocale('ru')
    context.setCurrentTheme('light')
    context.setCurrentTimezone('utc')
    context.setDataMode('mock')
    expect(records.map(event => event.name)).toEqual([
      'context:workspace-changed',
      'context:tenant-changed',
      'context:project-changed',
      'context:environment-changed',
      'context:user-changed',
      'context:locale-changed',
      'context:theme-changed',
      'context:timezone-changed',
      'context:data-mode-changed',
    ])
    expect(records[5].payload).toEqual({ previous: 'en', value: 'ru' })
    expect(records[6].payload).toEqual({ previous: 'dark', value: 'light' })
    const count = records.length
    context.setCurrentLocale('ru')
    context.setCurrentTheme('light')
    context.setDataMode('mock')
    context.notify()
    expect(records).toHaveLength(count)
  })

  it('tracks effective session identities and ignores hidden fallback changes', () => {
    let identity = { userId: 'signed-in', tenantId: 'session-tenant' }
    context.setSessionIdentityProvider({ getCurrentIdentity: () => identity })
    expect(records.map(event => event.name)).toEqual(['context:tenant-changed', 'context:user-changed'])
    records.length = 0
    context.setCurrentUser('fallback-user')
    expect(records).toEqual([])
    identity = { userId: 'other-user', tenantId: 'session-tenant' }
    context.notify()
    expect(records).toHaveLength(1)
    expect(records[0].payload).toEqual({ previous: 'signed-in', value: 'other-user' })
  })

  it('only emits effective data mode transitions, including override removal', () => {
    context.setDataMode('live')
    context.setWorkspaceDataMode('mock')
    expect(records).toEqual([])
    context.clearDataModeOverride()
    context.setDataMode('live')
    context.setCurrentWorkspace('another-workspace')
    expect(records.filter(event => event.name === 'context:data-mode-changed').map(event => event.payload)).toEqual([
      { previous: 'live', value: 'mock' },
      { previous: 'mock', value: 'live' },
      { previous: 'live', value: 'mock' },
    ])
  })

  it('publishes configuration reconciliation and normalized values once', () => {
    context.setCurrentLocale('unsupported')
    records.length = 0
    Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
    records.length = 0
    context.reconcileCurrentLocaleWithWorkspace()
    context.reconcileCurrentLocaleWithWorkspace()
    expect(records.filter(event => event.name === 'context:locale-changed').map(event => event.payload)).toEqual([
      { previous: 'unsupported', value: 'ru' },
    ])
  })

  it('bounds cyclic subscriber mutations and remains usable after unsubscribe', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const stop = Endge.events.onEvent('context:locale-changed', ({ payload }) => {
      context.setCurrentLocale(payload.value === 'ru' ? 'en' : 'ru')
    })
    expect(() => context.setCurrentLocale('ru')).not.toThrow()
    expect(errors).toHaveBeenCalledWith(expect.stringContaining('Cyclic context changes'))
    stop()
    records.length = 0
    context.setCurrentLocale('de')
    expect(records).toHaveLength(1)
    expect(records[0].payload).toEqual({ previous: expect.any(String), value: 'de' })
  })

  it('finishes a multi-variable commit before publishing changes caused by a listener', () => {
    context.setCurrentTenant('before')
    records.length = 0
    Endge.events.onEvent('context:tenant-changed', () => context.setCurrentProject('from-listener'))
    context.deserialize({ tenant: 'after', project: 'from-snapshot' })
    expect(records.filter(event => event.name === 'context:project-changed').map(event => event.payload)).toEqual([
      { previous: 'default', value: 'from-snapshot' },
      { previous: 'from-snapshot', value: 'from-listener' },
    ])
  })
})

describe('events delivery without history', () => {
  afterEach(() => vi.restoreAllMocks())

  it('delivers a burst without replay and releases both kinds of subscriptions on reset', () => {
    const bus = new EndgeEvents_Module()
    const observer = vi.fn()
    let count = 0
    bus.onAny(observer)
    bus.onDynamic('tick', () => count++)
    for (let i = 0; i < 10000; i++) {
      bus.emitDynamic('tick', i)
    }
    expect(count).toBe(10000)
    expect(observer).toHaveBeenCalledTimes(10000)
    const late = vi.fn()
    bus.onAny(late)
    expect(late).not.toHaveBeenCalled()
    bus.reset()
    bus.emitDynamic('tick', 10000)
    expect(count).toBe(10000)
    expect(late).not.toHaveBeenCalled()
  })

  it('isolates synchronous and asynchronous listener failures', async () => {
    const bus = new EndgeEvents_Module()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const last = vi.fn()
    bus.onAny(() => {
      throw new Error('observer')
    })
    bus.onDynamic('tick', () => {
      throw new Error('sync')
    })
    bus.onDynamic('tick', async () => {
      throw new Error('async')
    })
    bus.onDynamic('tick', last)
    expect(() => bus.emitDynamic('tick', 1)).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()
    expect(last).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledTimes(3)
  })

  it('fixes recipients of one delivery and permits idempotent unsubscribe', () => {
    const bus = new EndgeEvents_Module()
    const late = vi.fn()
    bus.onDynamic('tick', () => bus.onDynamic('tick', late))
    bus.emitDynamic('tick', 1)
    expect(late).not.toHaveBeenCalled()
    bus.emitDynamic('tick', 2)
    expect(late).toHaveBeenCalledTimes(1)
    const listener = vi.fn()
    const off = bus.onEvent('context:theme-changed', listener)
    off()
    off()
    bus.emitEvent('context:theme-changed', { previous: 'dark', value: 'light' })
    expect(listener).not.toHaveBeenCalled()
  })
})
