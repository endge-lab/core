import type { ProgramArtifact } from '@/domain/types/program/program.types'
import type { StoreSourceArtifact } from '@/domain/types/source/store-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it } from 'vitest'

import { RStore } from '@/domain/entities/reflect/RStore'
import { RMock } from '@/domain/entities/reflect/RMock'
import { StoreRuntimeHost } from '@/domain/entities/runtime/hosts/StoreRuntimeHost'
import { Endge } from '@/model/endge/kernel/endge'

describe('StoreRuntimeHost', () => {
  afterEach(() => {
    Endge.context.setDataMode('live')
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

  it('resolves a persisted mock before immediate derived materialization', () => {
    Endge.context.setDataMode('mock')
    const mock = new RMock()
    mock.id = 103
    mock.identity = 'groundhandling'
    mock.name = 'Ground Handling'
    mock.displayName = 'Ground Handling'
    mock.contentSource = 'document'
    mock.contentType = 'application/json'
    mock.source = JSON.stringify([
      { id: 1, flight: 'SU100' },
      { id: 2, flight: 'SU200' },
    ])
    Endge.domain.addMock(mock)

    const store = new RStore()
    store.id = 102
    store.identity = 'groundhandling-db'
    store.name = 'Ground Handling DB'
    store.source = `defineStore({
      data: {
        raw: value(mock('groundhandling')),
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

    expect(snapshot.raw).toEqual([
      { id: 1, flight: 'SU100' },
      { id: 2, flight: 'SU200' },
    ])
    expect(snapshot.table).toEqual(snapshot.raw)
    expect(runtime.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'data:raw',
        payload: expect.objectContaining({
          initializer: 'mock',
          mockIdentity: 'groundhandling',
        }),
      }),
    ]))

    snapshot.raw.splice(0)
    expect(Endge.mock.get<any[]>('groundhandling')).toHaveLength(2)
  })

  it('keeps mock-backed fields empty in live mode until a runtime publication writes them', () => {
    const mock = new RMock()
    mock.id = 106
    mock.identity = 'groundhandling-live'
    mock.name = 'Ground Handling Live'
    mock.displayName = mock.name
    mock.source = JSON.stringify([{ id: 1 }])
    Endge.domain.addMock(mock)

    const store = new RStore()
    store.id = 107
    store.identity = 'groundhandling-live-db'
    store.name = 'Ground Handling Live DB'
    store.source = `defineStore({
      data: {
        raw: value(mock('groundhandling-live')),
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
    Endge.program.beginCompile('test-live-mode')
    Endge.program.addArtifact({
      ref: { entityType: 'store', id: store.id, identity: store.identity },
      sourceHash: 'test-live-mode',
      compilerVersion: 'test',
      status: 'valid',
      diagnostics: [],
      dependencies: [],
      capabilities: ['compilable', 'executable', 'data-provider'],
      metadata: { self: {}, nodes: [] },
      payload,
    })

    const runtime = Endge.runtime.execute(store, { id: 'store:groundhandling-live' }) as StoreRuntimeHost
    expect(runtime.getDataSnapshot()).toEqual({})

    runtime.set('raw', [{ id: 2 }])
    expect(runtime.getDataSnapshot()).toEqual({
      raw: [{ id: 2 }],
      table: [{ id: 2 }],
    })
  })

  it('materializes a root select expression as the derived array itself', () => {
    const store = new RStore()
    store.id = 104
    store.identity = 'pairs-db'
    store.name = 'Pairs DB'
    store.source = `defineStore({
      data: {
        raw: value({
          pairsArrival: [{ id: 'A-null', arrivalLeg: { id: 'A' } }],
          pairsDeparture: [{ id: 'A-D', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } }],
        }),
        table: derived()
          .from('raw')
          .select(
            fullJoin('pairsArrival', 'pairsDeparture')
              .byAny('arrivalLeg.id', 'departureLeg.id')
              .coalesce(),
          ),
      },
    })`
    Endge.domain.addStore(store)

    const payload = Endge.source.compile('store', store.source).artifact as StoreSourceArtifact
    expect(payload).toBeTruthy()
    Endge.program.beginCompile('test-root-select')
    Endge.program.addArtifact({
      ref: { entityType: 'store', id: store.id, identity: store.identity },
      sourceHash: 'test-root-select',
      compilerVersion: 'test',
      status: 'valid',
      diagnostics: [],
      dependencies: [],
      capabilities: ['compilable', 'executable', 'data-provider'],
      metadata: { self: {}, nodes: [] },
      payload,
    })

    const runtime = Endge.runtime.execute(store, { id: 'store:pairs-db-preview' }) as StoreRuntimeHost

    expect(runtime.getDataSnapshot().table).toEqual([
      { id: 'A-null', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } },
    ])
  })
})
