import type { ProgramArtifact } from '@/domain/types/program/program.types'
import type { StoreSourceArtifact } from '@/domain/types/source/store-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it } from 'vitest'

import { RStore } from '@/domain/entities/reflect/RStore'
import { StoreRuntimeHost } from '@/domain/entities/runtime/hosts/StoreRuntimeHost'
import { Endge } from '@/model/endge/kernel/endge'

describe('StoreRuntimeHost', () => {
  afterEach(() => {
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Endge.mock.reset()
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

  it('resolves a registered mock before immediate derived materialization', () => {
    const store = new RStore()
    store.id = 102
    store.identity = 'groundhandling-db'
    store.name = 'Ground Handling DB'
    store.source = `defineStore({
      data: {
        raw: value(mock('groundhandling')),
        table: derived()
          .from('raw')
          .select({
            pairs: fullJoin('pairsArrival', 'pairsDeparture')
              .byAny('arrivalLeg.id', 'departureLeg.id')
              .coalesce(),
          }),
      },
    })`
    Endge.domain.addStore(store)

    const payload = Endge.source.compile('store', store.source).artifact as StoreSourceArtifact
    const artifact: ProgramArtifact<StoreSourceArtifact> = {
      ref: { entityType: 'store', id: store.id, identity: store.identity },
      sourceHash: 'test-mock',
      compilerVersion: 'test',
      status: 'valid',
      diagnostics: [],
      dependencies: [{
        entityType: 'mock-data',
        id: 'groundhandling',
        identity: 'groundhandling',
        role: 'store-initial:raw',
      }],
      capabilities: ['compilable', 'executable', 'data-provider'],
      metadata: { self: {}, nodes: [] },
      payload,
    }
    Endge.program.beginCompile('test')
    Endge.program.addArtifact(artifact)

    const runtime = Endge.runtime.execute(store, { id: 'store:groundhandling-db-preview' }) as StoreRuntimeHost
    const snapshot = runtime.getDataSnapshot() as any

    expect(snapshot.raw.pairsArrival).toHaveLength(2)
    expect(snapshot.raw.pairsDeparture).toHaveLength(1)
    expect(snapshot.table.pairs.map((row: any) => row.id)).toEqual([
      'SU1679_140726_ASF_1_null',
      'SU205_140726_PKX_1_null',
      'SU213_130726_HKG_1_SU296_140726_SVO_1',
    ])
    expect(runtime.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'data:raw',
        payload: expect.objectContaining({
          initializer: 'mock',
          mockIdentity: 'groundhandling',
        }),
      }),
    ]))

    snapshot.raw.pairsArrival.splice(0)
    expect(Endge.mock.get<any>('groundhandling').pairsArrival).toHaveLength(2)
  })
})
