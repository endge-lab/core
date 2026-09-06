import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { createUpdateStoreRuntime } from '@/test/fixtures/update-source'

describe('интеграция локального и stream-dispatched Update через Meta-plane', () => {
  afterEach(() => {
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('любое SSE-касание завершает waiting и классифицирует другое значение как overridden', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { rows: value([{ id: 1, carrier: 'LH' }]) } })`,
      updates: [
        {
          identity: 'local-edit',
          source: `defineUpdate({ mutations: [
            { strategy: 'set', target: 'rows[id=$id].carrier', value: input('value'), vars: { id: 'id' } },
            { strategy: 'set', target: meta('rows[id=$id].carrier', 'aodb.optimistic'), value: {
              status: 'waiting', optimisticValue: input('value'), previousValue: input('previousValue'),
            }, vars: { id: 'id' } },
          ] })`,
        },
        {
          identity: 'server-update',
          handles: ['ScheduleUpdated'],
          source: `defineUpdate({ handles: ['ScheduleUpdated'], mutations: [
            { strategy: 'set', target: 'rows[id=$id].carrier', value: input('record.carrier'), when: input('record').has('carrier'), vars: { id: 'record.id' } },
            { strategy: 'merge', target: meta('rows[id=$id].carrier', 'aodb.optimistic'), value: {
              status: 'synchronized', serverValue: input('record.carrier'),
              result: when(eq(input('record.carrier'), meta('rows[id=$id].carrier', 'aodb.optimistic').get('optimisticValue')), 'accepted', 'overridden'),
            }, when: and(input('record').has('carrier'), hasMeta('rows[id=$id].carrier', 'aodb.optimistic')), vars: { id: 'record.id' } },
          ] })`,
        },
      ],
    })
    runtime.applyUpdate('local-edit', { id: 1, value: 'SU', previousValue: 'LH' })
    expect(runtime.dispatch({ type: 'ScheduleUpdated', payload: { record: { id: 1 } }, meta: streamMeta() })).toBe(true)
    expect(Raph.meta.get(`${runtime.getDataPath()}.rows[id=1].carrier`, 'aodb.optimistic')).toMatchObject({ status: 'waiting' })

    runtime.dispatch({ type: 'ScheduleUpdated', payload: { record: { id: 1, carrier: 'TK' } }, meta: streamMeta() })
    expect(runtime.getDataSnapshot()).toEqual({ rows: [{ id: 1, carrier: 'TK' }] })
    expect(Raph.meta.get(`${runtime.getDataPath()}.rows[id=1].carrier`, 'aodb.optimistic')).toEqual({
      status: 'synchronized',
      optimisticValue: 'SU',
      previousValue: 'LH',
      serverValue: 'TK',
      result: 'overridden',
    })
  })

  it('старый artifact без plane исполняется как Data mutation', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { row: value({ value: 1 }) } })`,
      updates: [{ identity: 'legacy', source: `defineUpdate({ mutations: [{ strategy: 'set', target: 'row.value', valueFrom: 'value' }] })` }],
    })
    const artifact = Endge.program.getUpdateArtifact('legacy')!
    delete artifact.payload.mutations[0]!.plane
    runtime.applyUpdate('legacy', { value: 2 })
    expect(runtime.getDataSnapshot()).toEqual({ row: { value: 2 } })
  })
})

function streamMeta() {
  return { id: null, source: 'test', sourceEvent: 'ScheduleUpdated', occurredAt: new Date(0).toISOString() }
}
