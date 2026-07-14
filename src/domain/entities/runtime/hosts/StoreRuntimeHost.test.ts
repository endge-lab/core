import type { ProgramArtifact } from '@/domain/types/program.types'
import type { StoreSourceArtifact } from '@/domain/types/store-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it } from 'vitest'

import { RStore } from '@/domain/entities/reflect/RStore'
import { StoreRuntimeHost } from '@/domain/entities/runtime/hosts/StoreRuntimeHost'
import { Endge } from '@/model/endge/endge'

describe('StoreRuntimeHost', () => {
  afterEach(() => {
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('mounts default values, computes derived DataView immediately and owns its Raph state', () => {
    const store = new RStore()
    store.id = 101
    store.identity = 'schedule-db'
    store.name = 'Schedule DB'
    store.source = `defineStore({
      data: {
        raw: value([{ id: 1, flight: 'SU100' }]),
        table: derived()
          .from('raw')
          .dataView(defineDataView({
            mode: 'pipeline',
            steps: [
              from('').as('row'),
              map({ ...spread('row') }),
            ],
          })),
      },
    })`
    Endge.domain.addStore(store)

    const payload = Endge.source.compile('store', store.source).artifact as StoreSourceArtifact
    const artifact: ProgramArtifact<StoreSourceArtifact> = {
      ref: { entityType: 'store', id: store.id, identity: store.identity },
      sourceHash: 'test',
      compilerVersion: 'test',
      status: 'valid',
      diagnostics: [],
      dependencies: [],
      capabilities: ['compilable', 'executable', 'data-provider'],
      metadata: { self: {}, nodes: [] },
      payload,
    }
    Endge.program.beginCompile('test')
    Endge.program.addArtifact(artifact)

    const runtime = Endge.runtime.execute(store, { id: 'store:schedule-db-preview' }) as StoreRuntimeHost
    expect(runtime).toBeInstanceOf(StoreRuntimeHost)
    expect(runtime.getDataSnapshot()).toEqual({
      raw: [{ id: 1, flight: 'SU100' }],
      table: [{ id: 1, flight: 'SU100' }],
    })

    runtime.set('raw', [{ id: 2, flight: 'SU200' }])
    expect(runtime.getDataSnapshot()).toEqual({
      raw: [{ id: 2, flight: 'SU200' }],
      table: [{ id: 2, flight: 'SU200' }],
    })
    expect(() => runtime.set('table', [])).toThrow('derived or missing')

    const statePath = runtime.getDataPath()
    Endge.runtime.destroyRuntimeTree(runtime.id)
    expect(Raph.get(statePath)).toBeUndefined()
  })
})
