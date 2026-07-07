import { describe, expect, it } from 'vitest'

import { RField } from '@/domain/entities/reflect/RField'
import { RQueryFilter } from '@/domain/entities/reflect/RQueryFilter'
import { RQueryRest } from '@/domain/entities/reflect/RQueryRest'
import { ENDGE_CORE_MODULES } from '@/model/config/endge-modules'
import { Endge } from '@/model/endge/endge'
import { EndgeSource } from '@/model/endge/endge-source'

describe('EndgeSource', () => {
  it('is registered as an Endge federation module', () => {
    expect(ENDGE_CORE_MODULES.some(module => module.key === 'source')).toBe(true)
    expect(Endge.source).toBeInstanceOf(EndgeSource)
  })

  it('registers query source strategy by default', () => {
    const strategy = Endge.source.resolveStrategy('query')
    const languageStrategy = Endge.source.resolveLanguageStrategy('query')

    expect(strategy).toMatchObject({
      id: 'source:query',
      sourceKind: 'query',
    })
    expect(languageStrategy).toMatchObject({
      id: 'source-language:query',
      sourceKind: 'query',
    })
  })

  it('creates default query source through source language strategy', () => {
    const source = Endge.source.createDefault('query')
    const validation = Endge.source.validate('query', source)

    expect(source).toContain('defineQuery({')
    expect(source).toContain("kind: 'rest'")
    expect(validation.ok).toBe(true)
    expect(validation.diagnostics).toEqual([])
  })

  it('returns query source language completions', () => {
    const completions = Endge.source.completions('query', {
      source: '',
      position: { lineNumber: 1, column: 1 },
    })

    expect(completions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'defineQuery' }),
      expect.objectContaining({ label: 'field' }),
      expect.objectContaining({ label: 'filter.inline' }),
    ]))
  })

  it('generates query source from legacy RQueryRest fields', () => {
    const query = createQuery()
    const result = Endge.source.generate('query', query)

    expect(result.ok).toBe(true)
    expect(result.source).toContain('defineQuery({')
    expect(result.source).toContain("endpoint: env('API_BASE_URL')")
    expect(result.source).toContain("path: '/flights'")
    expect(result.source).toContain("filter.reference('flight-filter')")
    expect(result.source).toContain("flightDate: field('DateTime').optional()")
  })

  it('compiles query source into query program artifact payload', () => {
    const generated = Endge.source.generate('query', createQuery())
    const result = Endge.source.compile('query', generated.source!)

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.document).toMatchObject({
      kind: 'rest',
      request: {
        endpoint: '{API_BASE_URL}',
        path: '/flights',
        method: 'GET',
      },
    })
    expect(result.artifact).toMatchObject({
      type: 'query-rest',
      endpoint: '{API_BASE_URL}',
      query: '/flights',
      method: 'GET',
      subField: 'items',
      filterMode: 'merge',
    })
  })

  it('returns diagnostics for unsupported query source kind', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  kind: 'graphql',
})
`)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        code: 'query-source-kind-unsupported',
      }),
    ])
  })

  it('compiles env macro and legacy endgeVar macro into variable tokens', () => {
    const envResult = Endge.source.compile('query', `
defineQuery({
  request: {
    endpoint: env('ENDPOINT_AODB'),
    path: '/flights',
  },
})
`)
    const legacyResult = Endge.source.compile('query', `
defineQuery({
  request: {
    endpoint: endgeVar('ENDPOINT_AODB'),
    path: '/flights',
  },
})
`)

    expect(envResult.artifact).toMatchObject({ endpoint: '{ENDPOINT_AODB}' })
    expect(legacyResult.artifact).toMatchObject({ endpoint: '{ENDPOINT_AODB}' })
  })

  it('tracks unsupported query field diagnostics on the invalid field expression', () => {
    const source = `
defineQuery({
  params: {
    flightDate: DateTime,
  },
})
`
    const result = Endge.source.compile('query', source)
    const diagnostics = result.diagnostics as Array<{ code: string, severity: string, sourcePath?: string, start?: number, end?: number }>
    const diagnostic = diagnostics.find(item => item.code === 'query-source-field-unsupported')
    const start = source.indexOf('DateTime')

    expect(diagnostic).toEqual(expect.objectContaining({
      severity: 'error',
      sourcePath: 'params.flightDate',
      start,
      end: start + 'DateTime'.length,
    }))
  })
})

function createQuery(): RQueryRest {
  const query = new RQueryRest('Flights', new RField('result', 'FlightLeg', true))
  query.id = 1
  query.identity = 'flight-list'
  query.endpoint = '{API_BASE_URL}'
  query.query = '/flights'
  query.method = 'GET'
  query.headers = { Accept: 'application/json' }
  query.timeoutMs = 10000
  query.subField = 'items'
  query.params.set('flightDate', new RField('flightDate', 'DateTime', false, true))
  query.filters = [
    new RQueryFilter({ mode: 'reference', filterId: 'flight-filter' }),
    new RQueryFilter({ mode: 'inline', inlineJson: '{"active":true}' }),
  ]
  query.mockDataEnabled = true
  query.mockData = '{"items":[]}'

  return query
}
