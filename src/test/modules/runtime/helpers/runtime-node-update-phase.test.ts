import type { RuntimeHost, RuntimeHostUpdateContext } from '@/modules/runtime/domain/runtime-host.types'

import { RaphKernel, RaphNode, RaphSchedulerType } from '@endge/raph'
import { describe, expect, it } from 'vitest'

import { RuntimeNodeUpdatePhase } from '@/modules/runtime/helpers/raph-phases/runtime-node-update-phase'

describe('фаза обновления узлов runtime', () => {
  it('направляет наблюдаемые данные только в логический корень runtime', () => {
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
