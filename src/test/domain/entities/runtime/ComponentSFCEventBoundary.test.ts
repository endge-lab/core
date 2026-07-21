import { describe, expect, it, vi } from 'vitest'

import { ComponentSFCEventBoundary } from '@/domain/entities/runtime/ComponentSFCEventBoundary'
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
})
