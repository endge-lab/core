import { describe, expect, it } from 'vitest'

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
    const patchStrategy = Endge.source.resolvePatchStrategy('query')

    expect(strategy).toMatchObject({
      id: 'source:query',
      sourceKind: 'query',
    })
    expect(languageStrategy).toMatchObject({
      id: 'source-language:query',
      sourceKind: 'query',
    })
    expect(patchStrategy).toMatchObject({
      id: 'source-patch:query',
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
      expect.objectContaining({ label: 'env' }),
    ]))
  })

  it('compiles query source into query program artifact payload', () => {
    const result = Endge.source.compile('query', createQuerySource())

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

  it('treats empty response return field as no return schema', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  request: {
    endpoint: env('ENDPOINT_AODB'),
    path: '/select',
  },
  response: {
    subField: 'items',
    return: field(''),
  },
})
`)

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.artifact).toMatchObject({ returnField: null })
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

  it('patches query source slots without reprinting untouched author code', () => {
    const source = `
defineQuery({
  // keep author comment
  request: {
    endpoint: env('API_BASE_URL'),
    path: '/flights',
    method: 'GET',
  },
})
`

    const result = Endge.source.patch('query', source, {
      path: 'request.path',
      value: '/schedule',
    })

    expect(result.ok).toBe(true)
    expect(result.changed).toBe(true)
    expect(result.source).toContain('// keep author comment')
    expect(result.source).toContain("endpoint: env('API_BASE_URL')")
    expect(result.source).toContain("path: '/schedule'")
    expect(result.document).toMatchObject({
      request: {
        path: '/schedule',
      },
    })
  })

  it('patches query source with raw DSL expressions', () => {
    const source = `
defineQuery({
  response: {
    subField: 'items',
    return: null,
  },
})
`

    const result = Endge.source.patch('query', source, {
      path: 'response.return',
      expression: "field('FlightLeg').array()",
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain("return: field('FlightLeg').array()")
    expect(result.document).toMatchObject({
      response: {
        return: {
          type: 'FlightLeg',
          isArray: true,
        },
      },
    })
  })

  it('does not apply invalid raw DSL expressions', () => {
    const source = `
defineQuery({
  response: {
    return: null,
  },
})
`

    const result = Endge.source.patch('query', source, {
      path: 'response.return',
      expression: "field('FlightLeg",
    })

    expect(result.ok).toBe(false)
    expect(result.changed).toBe(false)
    expect(result.source).toBe(source)
  })
})

function createQuerySource(): string {
  return `
defineQuery({
  kind: 'rest',

  request: {
    endpoint: env('API_BASE_URL'),
    path: '/flights',
    method: 'GET',
    headers: { Accept: 'application/json' },
    auth: { mode: 'token' },
    timeoutMs: 10000,
  },

  params: {
    flightDate: field('DateTime').optional(),
  },

  filters: {
    mode: 'merge',
    items: [
      filter.reference('flight-filter'),
      filter.inline({ active: true }),
    ],
  },

  response: {
    subField: 'items',
    return: field('FlightLeg').array(),
  },

  mock: {
    enabled: true,
    data: { items: [] },
  },
})
`
}
