import { afterEach, describe, expect, it } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RStore } from '@/domain/entities/reflect/RStore'
import { Endge } from '@/model/endge/endge'

describe('EndgeCompiler composition validation', () => {
  afterEach(() => {
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('distinguishes missing query model from missing query artifact', () => {
    const composition = createComposition()

    const missingModel = Endge.compiler.buildComposition(composition)
    expect(missingModel.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'composition-query-missing',
        message: 'Query "schedule" не найден.',
      }),
    ]))

    const query = new RQuery()
    query.id = 10
    query.identity = 'schedule'
    query.name = 'Schedule'
    Endge.domain.addQuery(query)

    const missingArtifact = Endge.compiler.buildComposition(composition)
    expect(missingArtifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'composition-query-artifact-missing',
        message: 'Query "schedule" найден в домене, но не собран в compiled program. Проверьте source запроса или предыдущие ошибки build.',
      }),
    ]))
  })

  it('validates nested Composition references and rejects self-reference', () => {
    const composition = createNestedComposition('groundhandling-default')

    const missingModel = Endge.compiler.buildComposition(composition)
    expect(missingModel.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-composition-missing' }),
    ]))

    const child = new RComposition()
    child.id = 2
    child.identity = 'groundhandling-default'
    child.name = 'Ground handling requests'
    Endge.domain.addComposition(child)
    const missingArtifact = Endge.compiler.buildComposition(composition)
    expect(missingArtifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-composition-artifact-missing' }),
    ]))

    const selfReference = createNestedComposition('schedule-page')
    const selfArtifact = Endge.compiler.buildComposition(selfReference)
    expect(selfArtifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-self-reference' }),
    ]))
  })

  it('accepts public outputs of a compiled nested Composition', () => {
    const query = new RQuery()
    query.id = 10
    query.identity = 'groundhandling-query'
    query.name = 'Ground handling query'
    query.sourceVersion = 2
    query.source = `
defineQuery({
  kind: 'rest',
  request: {
    endpoint: 'https://example.test',
    path: '/groundhandling',
    method: 'POST',
  },
  outputs: {
    raw: output().from(response()),
  },
})
`
    const child = new RComposition()
    child.id = 11
    child.identity = 'groundhandling-default'
    child.name = 'Ground handling requests'
    child.source = `
defineComposition({
  runtimes: {
    query: query('groundhandling-query'),
  },
  outputs: {
    rows: output().fromRuntime('query').select('raw'),
  },
})
`
    Endge.domain.addQuery(query)
    Endge.domain.addComposition(child)
    const store = new RStore()
    store.id = 12
    store.identity = 'groundhandling-db'
    store.name = 'Ground handling DB'
    store.source = `defineStore({ data: { raw: value({ rows: [] }) } })`
    Endge.domain.addStore(store)
    Endge.compiler.buildQuery(query)
    Endge.compiler.buildComposition(child)

    const parent = createNestedCompositionWithOutput('groundhandling-default', 'rows', true)
    const artifact = Endge.compiler.buildComposition(parent)
    expect(artifact.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-output-selection-missing' }),
    ]))
    expect(artifact.status).toBe('valid')
  })

  it('compiles nested Composition dependencies before their consumers', () => {
    const parent = createNestedComposition('groundhandling-default')
    const child = new RComposition()
    child.id = 2
    child.identity = 'groundhandling-default'
    child.name = 'Ground handling requests'
    child.source = 'defineComposition({ runtimes: {}, outputs: {} })'

    // Payload repository возвращает identity-sort: consumer идет раньше dependency.
    Endge.domain.addComposition(parent)
    Endge.domain.addComposition(child)
    Endge.compiler.build({} as any)

    const artifact = Endge.program.getCompositionArtifact('schedule-page')
    expect(artifact?.status).toBe('valid')
    expect(artifact?.diagnostics).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-composition-artifact-missing' }),
    ]))
  })

  it('reports transitive Composition dependency cycles during compilation', () => {
    const first = createNestedComposition('second')
    first.identity = 'first'
    first.name = 'First'
    const second = createNestedComposition('first')
    second.id = 2
    second.identity = 'second'
    second.name = 'Second'
    Endge.domain.addComposition(first)
    Endge.domain.addComposition(second)

    Endge.compiler.build({} as any)

    expect(Endge.program.getCompositionArtifact('first')?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-reference-cycle' }),
    ]))
    expect(Endge.program.getCompositionArtifact('second')?.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-reference-cycle' }),
    ]))
  })
})

function createComposition(): RComposition {
  const composition = new RComposition()
  composition.id = 1
  composition.identity = 'schedule-page'
  composition.name = 'Schedule page'
  composition.source = `
defineComposition({
  runtimes: {
    query: query('schedule').withProps({}),
  },
  outputs: {
    query: output().fromRuntime('query'),
  },
})
`
  return composition
}

function createNestedComposition(identity: string): RComposition {
  const composition = new RComposition()
  composition.id = 1
  composition.identity = 'schedule-page'
  composition.name = 'Schedule page'
  composition.source = `
defineComposition({
  runtimes: {
    requests: composition('${identity}'),
  },
})
`
  return composition
}

function createNestedCompositionWithOutput(identity: string, output: string, storeTo = false): RComposition {
  const composition = createNestedComposition(identity)
  composition.source = `
defineComposition({
  ${storeTo ? `data: {
    db: store('groundhandling-db'),
  },` : ''}
  runtimes: {
    requests: composition('${identity}')${storeTo ? `
      .storeTo(data('db'), {
        'raw.rows': output('${output}'),
      })` : ''},
  },
  outputs: {
    rows: output().fromRuntime('requests').select('${output}'),
  },
})
`
  return composition
}
