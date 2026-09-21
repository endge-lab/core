import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { RUpdate } from '@/features/core/modules/domain/entities/RUpdate'
import { compileUpdateSource } from '@/features/core/modules/source/services/compilers/update-source-compile'
import { prepareTestCompilerContext, resetTestCompilerContext } from '@/test/helpers/compiler-context'

describe('компиляция условного Update Source', () => {
  it('сохраняет compact syntax и компилирует Meta target с безопасными expressions', () => {
    const legacy = compileUpdateSource(`defineUpdate({
      mutations: [{ strategy: 'merge', target: 'rows[id=$id]', valueFrom: 'patch', ifExists: 'rows[id=$id]', vars: { id: 'id' } }],
    })`)
    expect(legacy.artifact?.mutations[0]).toMatchObject({
      plane: 'data',
      target: 'rows[id=$id]',
      valueFrom: 'patch',
    })

    const result = compileUpdateSource(`defineUpdate({
      mutations: [{
        strategy: 'merge',
        target: meta('rows[id=$id].carrier', 'aodb.optimistic'),
        value: {
          status: 'synchronized',
          serverValue: input('record.carrier'),
          previous: data('rows[id=$id].carrier'),
          optimistic: meta('rows[id=$id].carrier', 'aodb.optimistic').get('optimisticValue'),
        },
        when: and(input('record').has('carrier'), hasData('rows[id=$id].carrier'), hasMeta('rows[id=$id].carrier', 'aodb.optimistic')),
        vars: { id: 'record.id' },
      }],
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.mutations[0]).toMatchObject({
      plane: 'meta',
      namespace: 'aodb.optimistic',
      target: 'rows[id=$id].carrier',
      value: { type: 'object' },
      when: { type: 'operation', operation: 'and' },
    })
  })

  it('компилирует input, item и parent с optional path', () => {
    const result = compileUpdateSource(`defineUpdate({
      mutations: [{ strategy: 'set', target: 'rows[id=$id]', forEach: 'groups[].rows[]', value: { root: input(), item: item(), parent: parent() }, vars: { id: 'id' } }],
    })`)
    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.mutations[0]?.value).toEqual({
      type: 'object',
      properties: {
        root: { type: 'read', source: 'update-input', path: '' },
        item: { type: 'read', source: 'update-item', path: '' },
        parent: { type: 'read', source: 'update-parent', path: '' },
      },
    })
  })

  it('диагностирует конфликт value/valueFrom, wildcard, пустой namespace и unsafe JavaScript', () => {
    const result = compileUpdateSource(`defineUpdate({ mutations: [
      { strategy: 'set', target: 'rows[*].value', valueFrom: 'value', value: fetch('/unsafe') },
      { strategy: 'set', target: meta('rows[0].value', ''), value: 1 },
      { strategy: 'set', target: 'rows[0].value', value: data('../other') },
    ] })`)
    expect(result.artifact).toBeNull()
    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'update-value-conflict',
      'update-target-wildcard',
      'update-meta-namespace-required',
      'update-read-path-invalid',
      'source-expression-unsupported',
    ]))
    expect(result.diagnostics.every(item => item.start == null || item.end != null)).toBe(true)
  })
})

describe('store ownership условного Update Source', () => {
  beforeEach(() => prepareTestCompilerContext())
  afterEach(() => resetTestCompilerContext())

  it('разрешает Meta target derived field и диагностирует Data target или read вне Store', () => {
    const store = new RStore()
    store.id = 901
    store.identity = 'update-ownership-store'
    store.name = store.identity
    store.source = `defineStore({ data: {
      raw: value([{ id: 1 }]),
      table: derived().from('raw').dataView(defineDataView({ mode: 'pipeline', steps: [from('').as('row'), map({ ...spread('row') })] })),
    } })`
    Endge.domain.addStore(store)

    Endge.domain.addUpdate(makeUpdate(902, 'annotate-derived', `defineUpdate({ mutations: [{
      strategy: 'set', target: meta('table[0].id', 'state'), value: data('missing.value'),
    }] })`, store.identity))
    Endge.domain.addUpdate(makeUpdate(903, 'write-derived', `defineUpdate({ mutations: [{
      strategy: 'set', target: 'table[0].id', value: 2,
    }] })`, store.identity))

    Endge.compiler.build({} as any)
    const artifact = Endge.program.getStoreArtifact(store.identity)!

    expect(artifact.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'store-update-target-invalid', sourcePath: 'updates.annotate-derived.mutations.0.target' }),
    ]))
    expect(artifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'store-update-read-invalid' }),
      expect.objectContaining({ code: 'store-update-target-invalid', sourcePath: 'updates.write-derived.mutations.0.target' }),
    ]))
  })
})

function makeUpdate(id: number, identity: string, source: string, storeIdentity: string): RUpdate {
  const update = new RUpdate()
  update.id = id
  update.identity = identity
  update.name = identity
  update.source = source
  update.storeIdentity = storeIdentity
  return update
}
