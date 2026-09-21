import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/features/core/modules/source/services/compilers/composition-source-compile'
import { compileDataViewSource } from '@/features/core/modules/source/services/compilers/data-view-source-compile'
import { compileFilterSource } from '@/features/core/modules/source/services/compilers/filter-source-compile'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'

const EXPECTED_METADATA = {
  'hub.tgo': {
    attributes: ['BestOn', 'FlightStatus'],
    priority: 10,
    enabled: true,
  },
}

describe('компиляция метаданных Source', () => {
  it.each([
    ['Query', compileQuerySource, `defineQuery({
      metadata: {
        'hub.tgo': { attributes: ['BestOn', 'FlightStatus'], priority: 10, enabled: true },
      },
      kind: 'rest',
      request: {
        endpoint: '', path: '/flights', method: 'GET', headers: {}, auth: { mode: 'inherit' },
      },
      outputs: { raw: output().from(response('items')) },
      mock: { enabled: false, data: null },
    })`],
    ['DataView', compileDataViewSource, `defineDataView({
      metadata: {
        'hub.tgo': { attributes: ['BestOn', 'FlightStatus'], priority: 10, enabled: true },
      },
      mode: 'pipeline',
      steps: [from('items').as('item'), map({ ...spread('item') })],
    })`],
    ['Filter', compileFilterSource, `defineFilter({
      metadata: {
        'hub.tgo': { attributes: ['BestOn', 'FlightStatus'], priority: 10, enabled: true },
      },
      fields: {},
      outputs: {},
    })`],
    ['Composition', compileCompositionSource, `defineComposition({
      metadata: {
        'hub.tgo': { attributes: ['BestOn', 'FlightStatus'], priority: 10, enabled: true },
      },
      data: {},
      runtimes: {},
      hooks: [],
      outputs: {},
    })`],
  ])('извлекает статические метаданные из Source %s', (_name, compile, source) => {
    const result = compile(source)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.metadata).toEqual(EXPECTED_METADATA)
  })

  it('отклоняет зависящие от runtime метаданные вместо их выполнения', () => {
    const result = compileFilterSource(`defineFilter({
      metadata: { 'hub.tgo': getAttributes() },
      fields: {},
      outputs: {},
    })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'program-metadata-value', severity: 'error' }),
    ]))
  })
})
