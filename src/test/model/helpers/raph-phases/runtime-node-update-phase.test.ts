import type { RuntimeHost, RuntimeHostUpdateContext } from '@/domain/types/runtime/runtime-host.types'

import { RaphKernel, RaphNode, RaphSchedulerType } from '@endge/raph'
import { describe, expect, it } from 'vitest'

import { RuntimeNodeUpdatePhase } from '@/model/helpers/raph-phases/runtime-node-update-phase'

describe('RuntimeNodeUpdatePhase', () => {
  it('routes observed data only to the logical runtime root', () => {
    const kernel = new RaphKernel()
    const runtime = kernel.createRuntime({ id: 'runtime-node-phase', scheduler: RaphSchedulerType.Sync })
    const updates: RuntimeHostUpdateContext[] = []
    const host = { update: (ctx: RuntimeHostUpdateContext) => updates.push(ctx) } as unknown as RuntimeHost
    const root = new RaphNode(runtime, {
      id: 'query-root',
      meta: { type: 'runtime-node', kind: 'root', runtimeId: 'query-1' },
    })
    const boundary = new RaphNode(runtime, {
      id: 'render-boundary',
      meta: { type: 'runtime-node', kind: 'boundary', runtimeId: 'query-1' },
    })
    runtime.definePhases([RuntimeNodeUpdatePhase.make({ resolveHost: () => host })])
    runtime.addNode(root)
    root.addChild(boundary)
    runtime.observeData(root, 'filters.request', { phase: RuntimeNodeUpdatePhase.PHASE_NAME })

    kernel.set('filters.request', { search: 'SU' })

    expect(updates).toHaveLength(1)
    expect(updates[0].node).toBe(root)
    expect(updates[0].boundaries).toEqual([])
    expect(updates[0].events[0].canonical).toBe('filters.request')
  })
})
