import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { createUpdateStoreRuntime } from '@/test/fixtures/update-source'

describe('meta mutations StoreRuntimeHost', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
  })

  it('не обходит незатронутую коллекцию при обновлении отдельного поля', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { counter: value(0), archive: value([]) } })`,
      updates: [{ identity: 'increment', source: `defineUpdate({ mutations: [{ strategy: 'set', target: 'counter', value: 1 }] })` }],
    })
    let reads = 0
    const row = {
      get payload() {
        reads += 1
        return 'large payload'
      },
    }
    const archive = [row]
    Raph.set(runtime.getDataPath('archive'), archive)
    reads = 0
    runtime.applyUpdate('increment', {})
    expect(Raph.get(runtime.getDataPath('counter'))).toBe(1)
    expect(Raph.get(runtime.getDataPath('archive'))).toBe(archive)
    expect(reads).toBe(0)
  })

  it('does not traverse other rows in the affected collection for a point update', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { rows: value([]) } })`,
      updates: [{ identity: 'point', source: `defineUpdate({ mutations: [
        { strategy: 'set', target: 'rows[id=$id].value', value: input('value'), vars: { id: 'id' } },
        { strategy: 'set', target: meta('rows[id=$id].value', 'state'), value: true, vars: { id: 'id' } },
      ] })` }],
    })
    const rows = Array.from({ length: 10000 }, (_, id) => ({ id, value: 0 }))
    Raph.set(runtime.getDataPath('rows'), rows)
    Raph.get(`${runtime.getDataPath()}.rows[id=5000]`)
    let reads = 0
    rows.forEach((row, index) => {
      if (index !== 5000) {
        Object.defineProperty(rows, index, { get() {
          reads++
          return row
        }, configurable: true })
      }
    })
    runtime.applyUpdate('point', { id: 5000, value: 7 })
    expect(rows[5000].value).toBe(7)
    expect(reads).toBe(0)
    expect(Raph.meta.get(`${runtime.getDataPath()}.rows[id=5000].value`, 'state')).toBe(true)
  })

  it('записывает Data и Meta одним Update и клонирует пользовательское значение', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { rows: value([{ id: 1, carrier: 'LH' }]) } })`,
      updates: [{
        identity: 'optimistic',
        source: `defineUpdate({ mutations: [
          { strategy: 'set', target: 'rows[id=$id].carrier', value: input('value'), vars: { id: 'id' } },
          { strategy: 'set', target: meta('rows[id=$id].carrier', 'aodb.optimistic'), value: {
            status: 'waiting', optimisticValue: input('value'), previousValue: input('previousValue'),
          }, vars: { id: 'id' } },
        ] })`,
      }],
    })
    const payload = { id: 1, value: 'SU', previousValue: 'LH' }
    runtime.applyUpdate('optimistic', payload)
    payload.value = 'changed-after-run'

    expect(runtime.getDataSnapshot()).toEqual({ rows: [{ id: 1, carrier: 'SU' }] })
    expect(Raph.meta.get(`${runtime.getDataPath()}.rows[id=1].carrier`, 'aodb.optimistic')).toEqual({
      status: 'waiting',
      optimisticValue: 'SU',
      previousValue: 'LH',
    })
  })

  it('вычисляет expressions всех plans из единого pre-update состояния', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { row: value({ value: 1 }) } })`,
      updates: [{
        identity: 'pre-state',
        source: `defineUpdate({ mutations: [
          { strategy: 'set', target: 'row.value', value: input('value') },
          { strategy: 'set', target: meta('row.value', 'audit'), value: { before: data('row.value'), after: input('value') } },
        ] })`,
      }],
    })

    runtime.applyUpdate('pre-state', { value: 2 })

    expect(runtime.getDataSnapshot()).toEqual({ row: { value: 2 } })
    expect(Raph.meta.get(runtime.getDataPath('row.value'), 'audit')).toEqual({ before: 1, after: 2 })
  })

  it('поддерживает все стратегии Meta и remove удаляет только выбранный namespace', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { row: value({ value: 1 }) } })`,
      updates: [
        { identity: 'set-meta', source: `defineUpdate({ mutations: [{ strategy: 'set', target: meta('row.value', 'state'), value: { count: 1 } }] })` },
        { identity: 'merge-meta', source: `defineUpdate({ mutations: [{ strategy: 'merge', target: meta('row.value', 'state'), value: { status: 'ready' } }] })` },
        { identity: 'replace-meta', source: `defineUpdate({ mutations: [{ strategy: 'replace', target: meta('row.value', 'state'), value: ['a'] }] })` },
        { identity: 'append-meta', source: `defineUpdate({ mutations: [{ strategy: 'append', target: meta('row.value', 'state'), value: 'b' }] })` },
        { identity: 'remove-meta', source: `defineUpdate({ mutations: [{ strategy: 'remove', target: meta('row.value', 'state') }] })` },
      ],
    })
    const path = runtime.getDataPath('row.value')
    Raph.meta.set(path, 'validation', true)
    runtime.applyUpdate('set-meta', {})
    runtime.applyUpdate('merge-meta', {})
    expect(Raph.meta.get(path, 'state')).toEqual({ count: 1, status: 'ready' })
    runtime.applyUpdate('replace-meta', {})
    runtime.applyUpdate('append-meta', {})
    expect(Raph.meta.get(path, 'state')).toEqual(['a', 'b'])
    runtime.applyUpdate('remove-meta', {})
    expect(Raph.meta.has(path, 'state')).toBe(false)
    expect(Raph.meta.get(path, 'validation')).toBe(true)
  })

  it('сохраняет пять существующих стратегий Data mutations', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { row: value({ value: 1, extra: true }), list: value([1]) } })`,
      updates: [
        { identity: 'set-data', source: `defineUpdate({ mutations: [{ strategy: 'set', target: 'row.value', value: 2 }] })` },
        { identity: 'merge-data', source: `defineUpdate({ mutations: [{ strategy: 'merge', target: 'row', value: { added: true } }] })` },
        { identity: 'replace-data', source: `defineUpdate({ mutations: [{ strategy: 'replace', target: 'row.value', value: 3 }] })` },
        { identity: 'append-data', source: `defineUpdate({ mutations: [{ strategy: 'append', target: 'list', value: 2 }] })` },
        { identity: 'remove-data', source: `defineUpdate({ mutations: [{ strategy: 'remove', target: 'row.extra' }] })` },
      ],
    })

    runtime.applyUpdate('set-data', {})
    runtime.applyUpdate('merge-data', {})
    runtime.applyUpdate('replace-data', {})
    runtime.applyUpdate('append-data', {})
    runtime.applyUpdate('remove-data', {})

    expect(runtime.getDataSnapshot()).toEqual({
      row: { value: 3, added: true },
      list: [1, 2],
    })
  })

  it('проверяет все Meta owners до первой записи и не допускает частичного Data update', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { row: value({ value: 1 }) } })`,
      updates: [{
        identity: 'invalid-owner',
        source: `defineUpdate({ mutations: [
          { strategy: 'set', target: 'row.value', value: 2 },
          { strategy: 'set', target: meta('row.missing', 'state'), value: true },
        ] })`,
      }],
    })
    expect(() => runtime.applyUpdate('invalid-owner', {})).toThrow('Meta owner does not exist')
    expect(runtime.getDataSnapshot()).toEqual({ row: { value: 1 } })
  })

  it('до записи обнаруживает, что предыдущий Data plan удалит owner последующего Meta plan', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { row: value({ value: 1 }) } })`,
      updates: [{
        identity: 'removed-owner',
        source: `defineUpdate({ mutations: [
          { strategy: 'replace', target: 'row', value: {} },
          { strategy: 'set', target: meta('row.value', 'state'), value: true },
        ] })`,
      }],
    })

    expect(() => runtime.applyUpdate('removed-owner', {})).toThrow('Meta owner does not exist')
    expect(runtime.getDataSnapshot()).toEqual({ row: { value: 1 } })
  })

  it('keeps live rows unchanged when a later structural plan is invalid', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { rows: value([{ id: 1, value: 0 }]) } })`,
      updates: [{ identity: 'invalid-batch', source: `defineUpdate({ mutations: [
        { strategy: 'set', target: 'rows[id=1].value', value: 7 },
        { strategy: 'set', target: 'rows[id=2]', value: 8 },
      ] })` }],
    })
    expect(() => runtime.applyUpdate('invalid-batch', {})).toThrow('plain-object')
    expect(Raph.get(runtime.getDataPath('rows'))).toEqual([{ id: 1, value: 0 }])
  })

  it('совмещает ifExists и when через AND и сохраняет legacy forEach semantics', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: { rows: value([{ id: 1, value: 0 }, { id: 2, value: 0 }]) } })`,
      updates: [{
        identity: 'conditional',
        source: `defineUpdate({ mutations: [{
          strategy: 'merge', target: 'rows[id=$id]', forEach: 'items[]', ifExists: 'rows[id=$id]',
          value: { id: item('id'), value: item('value'), batch: input('batch'), parentKind: parent('kind') },
          when: item('enabled'), vars: { id: 'id' },
        }] })`,
      }],
    })
    runtime.applyUpdate('conditional', {
      batch: 'B',
      kind: 'root',
      items: [
        { id: 1, value: 10, enabled: true },
        { id: 2, value: 20, enabled: false },
        { id: 3, value: 30, enabled: true },
      ],
    })
    expect(runtime.getDataSnapshot()).toEqual({
      rows: [
        { id: 1, value: 10, batch: 'B', parentKind: 'root' },
        { id: 2, value: 0 },
      ],
    })
  })

  it('разрешает Meta на materialized derived field, но запрещает Data write в него', () => {
    const runtime = createUpdateStoreRuntime({
      storeSource: `defineStore({ data: {
        raw: value([{ id: 1, value: 10 }]),
        table: derived().from('raw').dataView(defineDataView({ mode: 'pipeline', steps: [from('').as('row'), map({ ...spread('row') })] })),
      } })`,
      updates: [
        { identity: 'annotate-derived', source: `defineUpdate({ mutations: [{ strategy: 'set', target: meta('table[0].value', 'state'), value: 'ready' }] })` },
        { identity: 'write-derived', source: `defineUpdate({ mutations: [{ strategy: 'set', target: 'table[0].value', value: 20 }] })` },
      ],
    })

    runtime.applyUpdate('annotate-derived', {})
    expect(Raph.meta.get(`${runtime.getDataPath()}.table[0].value`, 'state')).toBe('ready')
    expect(() => runtime.applyUpdate('write-derived', {})).toThrow('derived or missing')
  })
})
