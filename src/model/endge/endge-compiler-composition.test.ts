import { afterEach, describe, expect, it } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RQuery } from '@/domain/entities/reflect/RQuery'
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
