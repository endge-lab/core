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
      expect.objectContaining({ label: 'filter' }),
      expect.objectContaining({ label: 'env' }),
    ]))
  })

  it('keeps syntax highlighting patterns inside each source language strategy', () => {
    const cases = [
      ['query', 'defineQuery'],
      ['data-view', 'defineDataView'],
      ['filter', 'defineFilter'],
      ['composition', 'defineComposition'],
    ] as const

    for (const [sourceKind, keyword] of cases) {
      const strategy = Endge.source.resolveLanguageStrategy(sourceKind)
      const rootPatterns = strategy?.syntax.tokenizer.root ?? []

      expect(strategy?.syntax.extensions).toHaveLength(1)
      expect(rootPatterns.some(rule => rule.token === 'keyword' && rule.pattern.test(keyword))).toBe(true)
      expect(rootPatterns.some(rule => rule.token === 'comment')).toBe(true)
      expect(rootPatterns.some(rule => rule.token === 'string')).toBe(true)
    }
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
      sourceVersion: 2,
      outputs: [
        {
          key: 'raw',
          source: { type: 'response', path: 'items' },
          store: { mode: 'default' },
        },
      ],
    })
  })

  it('rejects legacy params and filters instead of silently retaining them', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  kind: 'rest',
  params: {},
  filters: { mode: 'merge', items: [] },
})
`)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'query-source-legacy-property', sourcePath: 'params' }),
      expect.objectContaining({ code: 'query-source-legacy-property', sourcePath: 'filters' }),
    ]))
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

  it('uses profile as canonical query auth profile syntax', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  request: {
    endpoint: env('ENDPOINT_AODB'),
    path: '/select',
    auth: {
      mode: 'profile',
      profile: 'keycloak-dev',
    },
  },
})
`)

    expect(result.artifact).toMatchObject({
      auth: {
        mode: 'profile',
        profile: 'keycloak-dev',
        authProfileIdentity: 'keycloak-dev',
      },
    })

  })

  it('returns diagnostics for legacy response block', () => {
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

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'query-source-response-unsupported',
        severity: 'error',
      }),
    ]))
  })

  it('marks legacy params as unsupported Query v2 configuration', () => {
    const source = `
defineQuery({
  params: {
    flightDate: DateTime,
  },
})
`
    const result = Endge.source.compile('query', source)
    const diagnostics = result.diagnostics as Array<{ code: string, severity: string, sourcePath?: string }>
    const diagnostic = diagnostics.find(item => item.code === 'query-source-legacy-property')

    expect(diagnostic).toEqual(expect.objectContaining({
      severity: 'error',
      sourcePath: 'params',
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
  outputs: {},
})
`

    const result = Endge.source.patch('query', source, {
      path: 'outputs',
      expression: `{
  raw: output().from(response('items')).toStore(),
}`,
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain("raw: output().from(response('items')).toStore()")
    expect(result.document).toMatchObject({
      outputs: [
        {
          key: 'raw',
          source: { type: 'response', path: 'items' },
        },
      ],
    })
  })

  it('does not apply invalid raw DSL expressions', () => {
    const source = `
defineQuery({
  outputs: {},
})
`

    const result = Endge.source.patch('query', source, {
      path: 'outputs',
      expression: "{ raw: output().from(response('items')",
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

  outputs: {
    raw: output()
      .from(response('items'))
      .toStore(),
  },

  mock: {
    enabled: true,
    data: { items: [] },
  },
})
`
}
