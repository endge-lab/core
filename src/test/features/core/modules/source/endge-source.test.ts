import { describe, expect, it } from 'vitest'

import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeSource_Module } from '@/features/core/modules/source/EndgeSource_Module'

describe('модуль EndgeSource', () => {
  it('регистрируется как модуль федерации Endge', () => {
    expect(ENDGE_CORE_MODULES.some(module => module.key === 'source')).toBe(true)
    expect(Endge.source).toBeInstanceOf(EndgeSource_Module)
  })

  it('по умолчанию регистрирует стратегию Source для Query', () => {
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

  it('создаёт стандартный Source Query через стратегию языка Source', () => {
    const source = Endge.source.createDefault('query')
    const validation = Endge.source.validate('query', source)

    expect(source).toContain('defineQuery({')
    expect(source).toContain('kind: \'rest\'')
    expect(validation.ok).toBe(true)
    expect(validation.diagnostics).toEqual([])
  })

  it('создаёт и проверяет вариант Source для GraphQL Query', () => {
    const source = Endge.source.createDefault('query', 'graphql')
    const validation = Endge.source.validate('query', source)

    expect(source).toContain('kind: \'graphql\'')
    expect(source).toContain('document: gql`')
    expect(source).toContain('data(\'item\')')
    expect(validation.ok).toBe(true)
    expect(validation.diagnostics).toEqual([])
  })

  it('регистрирует и проверяет стратегии Source для Computation', () => {
    const source = Endge.source.createDefault('computation')
    const validation = Endge.source.validate('computation', source)

    expect(Endge.source.resolveStrategy('computation')).toMatchObject({ id: 'source:computation' })
    expect(Endge.source.resolveLanguageStrategy('computation')).toMatchObject({ id: 'source-language:computation' })
    expect(source).toContain('defineComputation({')
    expect(validation.ok).toBe(true)
  })

  it('возвращает подсказки языка Source для Query', () => {
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

  it('хранит patterns подсветки синтаксиса внутри каждой стратегии языка Source', () => {
    const cases = [
      ['query', 'defineQuery'],
      ['data-view', 'defineDataView'],
      ['filter', 'defineFilter'],
      ['composition', 'defineComposition'],
      ['computation', 'defineComputation'],
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

  it('подсвечивает каждый функциональный блок Composition', () => {
    const rootPatterns = Endge.source.resolveLanguageStrategy('composition')?.syntax.tokenizer.root ?? []
    const keywordPattern = rootPatterns.find(rule => rule.token === 'keyword')?.pattern

    expect(keywordPattern).toBeDefined()
    expect([
      'component',
      'composition',
      'filter',
      'filterView',
      'i18n',
      'operationHistory',
      'query',
      'store',
      'stream',
      'style',
      'vocab',
    ].every(keyword => keywordPattern?.test(keyword))).toBe(true)
  })

  it('предоставляет tokens GraphQL внутри tagged templates gql', () => {
    const tokenizer = Endge.source.resolveLanguageStrategy('query')?.syntax.tokenizer
    const graphQLOpen = tokenizer?.root.find(rule => rule.next === '@graphql')
    const graphQLRules = tokenizer?.graphql ?? []

    expect(graphQLOpen?.pattern.test('gql`')).toBe(true)
    expect(graphQLRules.some(rule => rule.token === 'keyword' && rule.pattern.test('mutation'))).toBe(true)
    expect(graphQLRules.some(rule => rule.token === 'variable' && rule.pattern.test('$legId'))).toBe(true)
    expect(graphQLRules.some(rule => rule.token === 'type.identifier' && rule.pattern.test('TypeGHActual'))).toBe(true)
    expect(graphQLRules.some(rule => rule.next === '@pop' && rule.pattern.test('`'))).toBe(true)
  })

  it('компилирует Source Query в payload артефакта программы Query', () => {
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
        },
      ],
    })
  })

  it('отклоняет legacy params и filters вместо их молчаливого сохранения', () => {
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

  it('возвращает диагностику для неподдерживаемого вида Source Query', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  kind: 'soap',
})
`)

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'query-source-kind-unsupported',
      }),
    ]))
  })

  it('компилирует документ GraphQL, variables и output data', () => {
    const result = Endge.source.compile('query', `
defineQuery({
  kind: 'graphql',
  props: defineProps({
    id: field('String'),
  }),
  request: {
    endpoint: env('ENDPOINT_GRAPHQL'),
    operationName: 'UpdateItem',
    document: gql\`
      mutation UpdateItem($id: ID!) {
        updateItem(id: $id) { id }
      }
    \`,
    variables: variables(({ prop }) => ({ id: prop('id') })),
    errorPolicy: 'throw',
  },
  outputs: {
    updated: output().from(data('updateItem')),
  },
})
`)

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.document).toMatchObject({
      kind: 'graphql',
      request: {
        endpoint: '{ENDPOINT_GRAPHQL}',
        operationName: 'UpdateItem',
        errorPolicy: 'throw',
      },
    })
    expect(result.artifact).toMatchObject({
      type: 'query-gql',
      endpoint: '{ENDPOINT_GRAPHQL}',
      operationName: 'UpdateItem',
      requestVariables: expect.any(Object),
      outputs: [{ key: 'updated', source: { type: 'response', path: 'updateItem' } }],
    })
  })

  it('компилирует macro env и legacy macro endgeVar в tokens переменных', () => {
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

  it('использует profile как канонический синтаксис профиля авторизации Query', () => {
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
      },
    })
  })

  it('возвращает диагностику для legacy-блока response', () => {
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

  it('помечает legacy params как неподдерживаемую конфигурацию Query v2', () => {
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

  it('изменяет слоты Source Query без повторной печати нетронутого авторского кода', () => {
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
    expect(result.source).toContain('endpoint: env(\'API_BASE_URL\')')
    expect(result.source).toContain('path: \'/schedule\'')
    expect(result.document).toMatchObject({
      request: {
        path: '/schedule',
      },
    })
  })

  it('изменяет Source Query сырыми DSL-выражениями', () => {
    const source = `
defineQuery({
  outputs: {},
})
`

    const result = Endge.source.patch('query', source, {
      path: 'outputs',
      expression: `{
  raw: output().from(response('items')),
}`,
    })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('raw: output().from(response(\'items\'))')
    expect(result.document).toMatchObject({
      outputs: [
        {
          key: 'raw',
          source: { type: 'response', path: 'items' },
        },
      ],
    })
  })

  it('не применяет некорректные сырые DSL-выражения', () => {
    const source = `
defineQuery({
  outputs: {},
})
`

    const result = Endge.source.patch('query', source, {
      path: 'outputs',
      expression: '{ raw: output().from(response(\'items\')',
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
    auth: { mode: 'inherit' },
    timeoutMs: 10000,
  },

  outputs: {
    raw: output()
      .from(response('items')),
  },

  mock: {
    enabled: true,
    data: { items: [] },
  },
})
`
}
