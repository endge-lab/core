import { describe, expect, it, vi } from 'vitest'

import { ComponentSFCEventBoundary } from '@/domain/entities/runtime/ComponentSFCEventBoundary'
import type { RComponentSFC_IR_EventBinding } from '@/domain/types/component/sfc'
import { createEmptyComponentSFCPortManifest } from '@/domain/types/component/sfc'

describe('ComponentSFCEventBoundary', () => {
  it('routes a nested Event through forwarding while keeping reaction independent', async () => {
    const rootManifest = createEmptyComponentSFCPortManifest()
    rootManifest.emits.events.push({
      kind: 'event',
      role: 'emits',
      name: 'rowActivated',
      payloadType: 'TableRowActivatedEvent',
      forwardedFrom: { nodeId: 'child-node', ref: 'table', componentTag: 'Child', portName: 'rowActivated' },
      action: { kind: 'action', identity: 'audit.write', input: { kind: 'event', path: null } },
    })
    const childManifest = createEmptyComponentSFCPortManifest()
    childManifest.emits.events.push({ kind: 'event', role: 'emits', name: 'rowActivated', payloadType: 'TableRowActivatedEvent' })
    const host = {
      publishEventPort: vi.fn(),
      executeEventPortAction: vi.fn(async () => undefined),
      emit: vi.fn(),
    }
    const root = new ComponentSFCEventBoundary(host as any, 'root', rootManifest)
    const child = root.createChild('child', childManifest, {
      nodeId: 'child-node',
      ref: 'table',
      componentTag: 'Child',
    })

    await child.emitOwn('rowActivated', { rowId: '1' })
    await Promise.resolve()

    expect(host.publishEventPort).toHaveBeenCalledWith('rowActivated', { rowId: '1' }, expect.anything())
    expect(host.executeEventPortAction).toHaveBeenCalledTimes(2)
  })

  it('executes a local tag reaction and keeps routing when stop is absent', async () => {
    const manifest = createEmptyComponentSFCPortManifest()
    manifest.emits.events.push({
      kind: 'event',
      role: 'emits',
      name: 'titleClicked',
      payloadType: 'ComponentSFCPointerEventPayload',
      forwardedFrom: { nodeId: 'title', ref: 'title', componentTag: 'Text', portName: 'click' },
    })
    const host = {
      publishEventPort: vi.fn(),
      executeEventPortAction: vi.fn(async () => undefined),
      emit: vi.fn(),
    }
    const boundary = new ComponentSFCEventBoundary(host as any, 'orders', manifest)
    const source = { nodeId: 'title', ref: 'title', componentTag: 'Text' }

    await boundary.routeChild(source, 'click', { button: 0 }, [{
      name: 'click',
      modifiers: [],
      action: { kind: 'action', identity: 'orders.open', input: { kind: 'event', path: null } },
    }])

    expect(host.executeEventPortAction).toHaveBeenCalledTimes(2)
    expect(host.publishEventPort).toHaveBeenCalledWith('titleClicked', { button: 0 }, source)
  })

  it('executes a local tag reaction but stops public routing with .stop', async () => {
    const manifest = createEmptyComponentSFCPortManifest()
    manifest.emits.events.push({
      kind: 'event',
      role: 'emits',
      name: 'titleClicked',
      payloadType: 'ComponentSFCPointerEventPayload',
      forwardedFrom: { nodeId: 'title', ref: 'title', componentTag: 'Text', portName: 'click' },
    })
    const host = {
      publishEventPort: vi.fn(),
      executeEventPortAction: vi.fn(async () => undefined),
      emit: vi.fn(),
    }
    const boundary = new ComponentSFCEventBoundary(host as any, 'orders', manifest)

    await boundary.routeChild(
      { nodeId: 'title', ref: 'title', componentTag: 'Text' },
      'click',
      { button: 0 },
      [{
        name: 'click',
        modifiers: ['stop'],
        action: { kind: 'action', identity: 'orders.open', input: { kind: 'event', path: null } },
      }],
    )

    expect(host.executeEventPortAction).toHaveBeenCalledTimes(1)
    expect(host.publishEventPort).not.toHaveBeenCalled()
  })

  it('executes a local .once reaction once without consuming later public occurrences', async () => {
    const manifest = createEmptyComponentSFCPortManifest()
    manifest.emits.events.push({
      kind: 'event',
      role: 'emits',
      name: 'titleClicked',
      payloadType: 'ComponentSFCPointerEventPayload',
      forwardedFrom: { nodeId: 'title', ref: 'title', componentTag: 'Text', portName: 'click' },
    })
    const host = {
      publishEventPort: vi.fn(),
      executeEventPortAction: vi.fn(async () => undefined),
      emit: vi.fn(),
    }
    const boundary = new ComponentSFCEventBoundary(host as any, 'orders', manifest)
    const source = { nodeId: 'title', ref: 'title', componentTag: 'Text' }
    const bindings: RComponentSFC_IR_EventBinding[] = [{
      name: 'click',
      modifiers: ['once'],
      action: { kind: 'action', identity: 'audit.track-click', input: { kind: 'event', path: null } },
      sourceRange: { start: 10, end: 20 },
    }]

    await boundary.routeChild(source, 'click', { button: 0 }, bindings)
    await boundary.routeChild(source, 'click', { button: 0 }, bindings)

    expect(host.executeEventPortAction).toHaveBeenCalledTimes(3)
    expect(host.publishEventPort).toHaveBeenCalledTimes(2)
  })
})
