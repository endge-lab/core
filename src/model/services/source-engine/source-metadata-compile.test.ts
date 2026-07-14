import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/model/services/source-engine/composition-source-compile'
import { compileDataViewSource } from '@/model/services/source-engine/data-view-source-compile'
import { compileFilterSource } from '@/model/services/source-engine/filter-source-compile'
import { compileQuerySource } from '@/model/services/source-engine/query-source-compile'

const EXPECTED_METADATA = {
  'hub.tgo': {
    attributes: ['BestOn', 'FlightStatus'],
    priority: 10,
    enabled: true,
  },
}

describe('source metadata compilation', () => {
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
  ])('extracts static metadata from %s source', (_name, compile, source) => {
    const result = compile(source)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.metadata).toEqual(EXPECTED_METADATA)
  })

  it('rejects runtime-dependent metadata instead of executing it', () => {
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
