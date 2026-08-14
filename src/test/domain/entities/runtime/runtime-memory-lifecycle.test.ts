import { afterEach, describe, expect, it, vi } from 'vitest'
import { Raph, RaphNode } from '@endge/raph'

import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { RuntimeHostRegistry } from '@/domain/entities/runtime/RuntimeHostRegistry'
import type { ProgramArtifact, QueryProgramPayload } from '@/domain/types/program/program.types'
import type { RuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'
import { Endge } from '@/model/kernel/endge'

describe('runtime memory lifecycle', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Raph.app.reset()
  })

  it('processes every delivered update binding without structural hashing', () => {
    const model = queryModel(1)
    const host = new TestQueryHost(model)
    const node = new RaphNode(Raph.app, { id: 'binding-node' })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.bindUpdate({ id: 'refresh', sourcePath: 'source.rows', update: { kind: 'run' } })
    const listener = vi.fn()
    host.on('update', listener)
    const update = {
      phase: 'runtime-node-update' as any,
      node,
      frame: {} as any,
      boundaries: [],
      events: [{ original: 'source.rows', canonical: 'source.rows', canonicalDataPath: {} as any, resolved: [] }],
    }

    host.update(update)
    host.update(update)

    expect(listener).toHaveBeenCalledTimes(2)
    expect('_updateHashes' in (host as unknown as Record<string, unknown>)).toBe(false)
    host.destroy()
  })

  it('keeps destroyed snapshots disabled by default', async () => {
    const host = executeQuery(1)
    await Endge.runtime.destroyRuntimeTreeAsync(host.id)
    expect(Endge.runtime.getDeletedRuntimeHostSnapshots()).toEqual([])
  })

  it('removes a child from the registry index after host cleanup clears its parent reference', () => {
    const registry = new RuntimeHostRegistry()
    const parent = new TestQueryHost(queryModel(1), 'parent')
    const child = new TestQueryHost(queryModel(2), 'child', parent)
    registry.register(parent)
    registry.register(child)

    child.destroy()
    registry.removeById(child.id)

    expect(registry.getTreePostOrder(parent.id)).toEqual([parent.id])
    parent.destroy()
    registry.removeById(parent.id)
  })

  it('uses the maximum lease capacity, trims immediately and stores no runtime payloads', async () => {
    const small = Endge.runtime.acquireDestroyedHostSnapshots(2)
    const large = Endge.runtime.acquireDestroyedHostSnapshots(4)
    try {
      for (let id = 1; id <= 5; id++) {
        const host = executeQuery(id, {
          huge: Array.from({ length: 1_000 }, (_, index) => ({ index, value: 'x'.repeat(100) })),
        })
        await Endge.runtime.destroyRuntimeTreeAsync(host.id)
      }

      const snapshots = Endge.runtime.getDeletedRuntimeHostSnapshots()
      expect(snapshots.map(snapshot => snapshot.id)).toEqual([
        'query-runtime-2', 'query-runtime-3', 'query-runtime-4', 'query-runtime-5',
      ])
      expect(snapshots[0]).toMatchObject({
        previousStatus: 'active',
        status: 'destroyed',
        resources: expect.any(Array),
        channels: expect.any(Array),
      })
      expect('meta' in snapshots[0]).toBe(false)
      expect('context' in snapshots[0]).toBe(false)
      expect(JSON.stringify(snapshots)).not.toContain('huge')

      large.release()
      expect(Endge.runtime.getDeletedRuntimeHostSnapshots().map(snapshot => snapshot.id)).toEqual([
        'query-runtime-4', 'query-runtime-5',
      ])
      large.release()
      small.release()
      expect(Endge.runtime.getDeletedRuntimeHostSnapshots()).toEqual([])
    }
    finally {
      large.release()
      small.release()
    }
  })
})

class TestQueryHost extends RuntimeHostBase<'query', RuntimeHostContext<'query'>> {
  constructor(model: RQuery, id = 'test-host', parent: TestQueryHost | null = null) {
    super({
      id, kind: 'query', runtimeType: 'test-query', entityType: 'query',
      entityIdentity: model.identity, model, parent,
      context: { status: 'idle', startedAt: null, updatedAt: null, lastFilterChangeAt: null },
    })
  }
}

function executeQuery(id: number, meta: Record<string, unknown> = {}) {
  const model = queryModel(id)
  const artifact = queryArtifact(id)
  const host = Endge.runtime.execute(model, {
    id: `query-runtime-${id}`,
    persistence: 'disabled',
    artifactReader: { getArtifact: () => artifact as any },
    meta,
  })
  if (!host)
    throw new Error('query runtime was not created')
  return host
}

function queryModel(id: number): RQuery {
  const model = new RQuery()
  model.id = id
  model.identity = `query-${id}`
  model.name = model.identity
  return model
}

function queryArtifact(id: number): ProgramArtifact<QueryProgramPayload> {
  return {
    ref: { entityType: 'query', id, identity: `query-${id}` },
    sourceHash: 'test', compilerVersion: 'test', status: 'valid', diagnostics: [],
    dependencies: [], capabilities: ['compilable', 'runnable', 'data-provider'],
    metadata: { self: {}, nodes: [] },
    payload: {
      type: 'query-rest', sourceVersion: 2, endpoint: '', query: '', props: [],
      requestBody: null, outputs: [],
    },
  }
}
