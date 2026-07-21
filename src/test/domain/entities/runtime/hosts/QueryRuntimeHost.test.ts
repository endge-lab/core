import type { ProgramArtifact, QueryProgramPayload } from '@/domain/types/program/program.types'
import type { FilterProgramPayload } from '@/domain/types/source/filter-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RQuery } from '@/domain/entities/reflect/RQuery'
import { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import { compileFilterSource } from '@/model/services/source-engine/compilers/filter-source-compile'
import { Endge } from '@/model/endge/kernel/endge'

describe('QueryRuntimeHost', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Endge.context.setDataMode('live')
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('uses latest-wins, aborts previous transport and ignores stale result', async () => {
    const first = deferred<Record<string, unknown>>()
    const second = deferred<Record<string, unknown>>()
    const signals: AbortSignal[] = []
    vi.spyOn(Endge.runtime.query, 'executeArtifact')
      .mockImplementationOnce((input) => {
        signals.push(input.signal!)
        return first.promise
      })
      .mockImplementationOnce((input) => {
        signals.push(input.signal!)
        return second.promise
      })
    const host = createHost()

    const firstRun = host.run()
    const secondRun = host.run()
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)

    second.resolve({ raw: 'new' })
    await secondRun
    first.resolve({ raw: 'old' })
    await firstRun

    expect(host.getOutput('raw')).toBe('new')
    expect(host.context.status).toBe('success')
    expect(host.getOutputs()).toEqual({ raw: 'new' })
  })

  it('updates declared props without store-key remount restrictions', () => {
    const host = createHost({ filterPayload: { active: true } })
    expect(host.getProps()).toEqual({ filterPayload: { active: true } })
    host.setProps({ filterPayload: { active: false } })
    expect(host.getProps()).toEqual({ filterPayload: { active: false } })
  })

  it('skips transport and aborts an in-flight request when mock mode is enabled', async () => {
    const request = deferred<Record<string, unknown>>()
    const execute = vi.spyOn(Endge.runtime.query, 'executeArtifact')
      .mockImplementation(input => new Promise((resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        request.promise.then(resolve, reject)
      }))
    const host = createHost()
    const skipped = vi.fn()
    host.on('run:skipped', skipped)

    const liveRun = host.run()
    Endge.context.setDataMode('mock')
    await liveRun
    const result = await host.run()

    expect(execute).toHaveBeenCalledTimes(1)
    expect(result).toEqual({})
    expect(skipped).toHaveBeenCalledWith({ reason: 'mock-mode' })
  })

  it('mounts a local default Filter only without an explicit prop and owns its lifecycle', () => {
    const filterPayload = compileFilterSource(`
defineFilter({
  fields: { search: field('String').optional().default('SU') },
  outputs: {
    request: output().json(({ value }) => compact({ where: { search: value('search') } })),
  },
})
`).artifact!
    const childArtifact: ProgramArtifact<FilterProgramPayload> = {
      ...artifactBase('filter', 'local-filter', filterPayload),
      capabilities: ['compilable', 'executable', 'data-provider', 'configuration'],
    }
    const payload: QueryProgramPayload = {
      type: 'query-rest', sourceVersion: 2, endpoint: '', query: '',
      props: [{
        key: 'filterPayload', type: 'Object', optional: true, array: false,
        defaultSource: {
          kind: 'local-filter',
          ref: childArtifact.ref as { entityType: 'filter', id: string | number, identity: string },
          output: 'request',
        },
      }],
      requestBody: null, outputs: [],
    }
    const queryArtifact: ProgramArtifact<QueryProgramPayload> = {
      ...artifactBase('query', 20, payload),
      capabilities: ['compilable', 'runnable', 'data-provider'],
      children: [childArtifact],
    }
    const query = new RQuery()
    query.id = 20
    query.identity = 'query-with-default-filter'
    query.name = 'Query with default filter'
    Endge.domain.addQuery(query)
    Endge.program.beginCompile('test')
    Endge.program.addArtifact(queryArtifact)

    const host = Endge.runtime.execute(query, { id: 'query-with-child', persistence: 'disabled' }) as QueryRuntimeHost
    expect(host.getProps()).toEqual({ filterPayload: { where: { search: 'SU' } } })
    expect(Endge.runtime.getRuntimeHosts()).toHaveLength(2)
    const child = Endge.runtime.getRuntimeHosts().find(runtime => runtime.parent?.id === host.id)
    expect(child?.id).toBe('app:filter:local-filter-0')
    expect(child?.basePath).toBe('runtime.filters.local-filter-0')
    Endge.runtime.destroyRuntime(host.id)
    expect(Endge.runtime.getRuntimeHosts()).toEqual([])

    const explicit = Endge.runtime.execute(query, {
      id: 'query-with-explicit-prop',
      persistence: 'disabled',
      meta: { props: { filterPayload: { explicit: true } } },
    }) as QueryRuntimeHost
    expect(explicit.getProps()).toEqual({ filterPayload: { explicit: true } })
    expect(Endge.runtime.getRuntimeHosts()).toHaveLength(1)
  })
})

function createHost(props: Record<string, unknown> = {}): QueryRuntimeHost {
  const payload: QueryProgramPayload = {
    type: 'query-rest',
    sourceVersion: 2,
    endpoint: 'https://example.test',
    query: '/search',
    props: [{ key: 'filterPayload', type: 'Object', optional: true, array: false }],
    requestBody: null,
    outputs: [],
  }
  const artifact: ProgramArtifact<QueryProgramPayload> = {
    ref: { entityType: 'query', id: 1, identity: 'test-query' },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'runnable', 'data-provider'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
  const model = new RQuery()
  model.id = 1
  model.identity = 'test-query'
  model.name = 'Test Query'
  const host = QueryRuntimeHost.createRuntime({
    id: 'query-runtime',
    model,
    meta: { props },
    artifacts: { getArtifact: () => artifact as any },
  })
  if (!host)
    throw new Error('Query host was not created')
  return host
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function artifactBase<T>(
  entityType: ProgramArtifact['ref']['entityType'],
  id: string | number,
  payload: T,
): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity: String(id) },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
