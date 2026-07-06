import { describe, expect, it } from 'vitest'
import {
  RaphKernel,
  RaphNode,
  RaphSchedulerType,
} from '@endge/raph'

import { RuntimeBoundaryUpdatePhase } from '@/model/helpers/raph-phases/runtime-boundary-update-phase'
import type { RuntimeHost, RuntimeHostUpdateContext } from '@/domain/types/runtime-host.types'

function createRuntimeNode(
  runtime: ReturnType<RaphKernel['createRuntime']>,
  id: string,
  kind: 'root' | 'boundary' | 'leaf',
  runtimeId = 'runtime-1',
): RaphNode {
  return new RaphNode(runtime, {
    id,
    meta: {
      type: 'runtime-node',
      kind,
      runtimeId,
      entityType: 'component-sfc',
      entityIdentity: 'test-sfc',
    },
  })
}

function createFixture() {
  const kernel = new RaphKernel()
  const runtime = kernel.createRuntime({
    id: 'runtime-boundary-test',
    scheduler: RaphSchedulerType.Sync,
  })
  const updates: RuntimeHostUpdateContext[] = []
  const host = {
    update: (ctx: RuntimeHostUpdateContext) => updates.push(ctx),
  } as unknown as RuntimeHost

  runtime.definePhases([
    RuntimeBoundaryUpdatePhase.make({
      getGraph: () => runtime.graph,
      resolveHost: () => host,
    }),
  ])

  return { kernel, runtime, updates }
}

describe('RuntimeBoundaryUpdatePhase', () => {
  it('updates root host once when root node is dirty', () => {
    const { kernel, runtime, updates } = createFixture()
    const root = createRuntimeNode(runtime, 'root', 'root')

    runtime.addNode(root)
    runtime.observeData(root, 'data.root', { phase: RuntimeBoundaryUpdatePhase.PHASE_NAME })

    kernel.set('data.root', 1)

    expect(updates).toHaveLength(1)
    expect(updates[0].node.id).toBe('root')
    expect(updates[0].boundaries).toEqual([])
    expect(updates[0].events).toHaveLength(1)
  })

  it('aggregates dirty boundary into root update', () => {
    const { kernel, runtime, updates } = createFixture()
    const root = createRuntimeNode(runtime, 'root', 'root')
    const boundary = createRuntimeNode(runtime, 'boundary', 'boundary')

    runtime.addNode(root)
    root.addChild(boundary)
    runtime.observeData(boundary, 'data.boundary', { phase: RuntimeBoundaryUpdatePhase.PHASE_NAME })

    kernel.set('data.boundary', 1)

    expect(updates).toHaveLength(1)
    expect(updates[0].node.id).toBe('root')
    expect(updates[0].boundaries).toHaveLength(1)
    expect(updates[0].boundaries[0].boundary.id).toBe('boundary')
    expect(updates[0].boundaries[0].dirtyNodes.map(node => node.id)).toEqual(['boundary'])
  })

  it('aggregates dirty leaf into nearest boundary and root', () => {
    const { kernel, runtime, updates } = createFixture()
    const root = createRuntimeNode(runtime, 'root', 'root')
    const boundary = createRuntimeNode(runtime, 'boundary', 'boundary')
    const leaf = createRuntimeNode(runtime, 'leaf', 'leaf')

    runtime.addNode(root)
    root.addChild(boundary)
    boundary.addChild(leaf)
    runtime.observeData(leaf, 'data.leaf', { phase: RuntimeBoundaryUpdatePhase.PHASE_NAME })

    kernel.set('data.leaf', 1)

    expect(updates).toHaveLength(1)
    expect(updates[0].node.id).toBe('root')
    expect(updates[0].boundaries[0].boundary.id).toBe('boundary')
    expect(updates[0].boundaries[0].dirtyNodes.map(node => node.id)).toEqual(['leaf'])
  })

  it('merges several dirty leaf nodes in one boundary into one root update', () => {
    const { kernel, runtime, updates } = createFixture()
    const root = createRuntimeNode(runtime, 'root', 'root')
    const boundary = createRuntimeNode(runtime, 'boundary', 'boundary')
    const firstLeaf = createRuntimeNode(runtime, 'leaf-1', 'leaf')
    const secondLeaf = createRuntimeNode(runtime, 'leaf-2', 'leaf')

    runtime.addNode(root)
    root.addChild(boundary)
    boundary.addChild(firstLeaf)
    boundary.addChild(secondLeaf)
    runtime.observeData(firstLeaf, 'data.first', { phase: RuntimeBoundaryUpdatePhase.PHASE_NAME })
    runtime.observeData(secondLeaf, 'data.second', { phase: RuntimeBoundaryUpdatePhase.PHASE_NAME })

    kernel.transaction(() => {
      kernel.set('data.first', 1)
      kernel.set('data.second', 2)
    })

    expect(updates).toHaveLength(1)
    expect(updates[0].boundaries).toHaveLength(1)
    expect(updates[0].boundaries[0].events).toHaveLength(2)
    expect(updates[0].boundaries[0].dirtyNodes.map(node => node.id).sort()).toEqual(['leaf-1', 'leaf-2'])
  })

  it('keeps separate boundary records under the same root', () => {
    const { kernel, runtime, updates } = createFixture()
    const root = createRuntimeNode(runtime, 'root', 'root')
    const firstBoundary = createRuntimeNode(runtime, 'boundary-1', 'boundary')
    const secondBoundary = createRuntimeNode(runtime, 'boundary-2', 'boundary')
    const firstLeaf = createRuntimeNode(runtime, 'leaf-1', 'leaf')
    const secondLeaf = createRuntimeNode(runtime, 'leaf-2', 'leaf')

    runtime.addNode(root)
    root.addChild(firstBoundary)
    root.addChild(secondBoundary)
    firstBoundary.addChild(firstLeaf)
    secondBoundary.addChild(secondLeaf)
    runtime.observeData(firstLeaf, 'data.first', { phase: RuntimeBoundaryUpdatePhase.PHASE_NAME })
    runtime.observeData(secondLeaf, 'data.second', { phase: RuntimeBoundaryUpdatePhase.PHASE_NAME })

    kernel.transaction(() => {
      kernel.set('data.first', 1)
      kernel.set('data.second', 2)
    })

    expect(updates).toHaveLength(1)
    expect(updates[0].boundaries.map(item => item.boundary.id).sort()).toEqual(['boundary-1', 'boundary-2'])
  })
})
