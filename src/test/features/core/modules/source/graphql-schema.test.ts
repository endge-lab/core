import { buildSchema, introspectionFromSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import {
  createGraphQLIntrospectionQuery,
  loadGraphQLSchema,
  validateGraphQLDocument,
} from '@/main'

const SDL = `
  interface Node { id: ID! }
  type Order implements Node { id: ID!, status: OrderStatus!, items(first: Int): [String!]! }
  enum OrderStatus { NEW DONE }
  input OrderFilter { status: OrderStatus, limit: Int = 10 }
  type Query { order(id: ID!): Order, orders(filter: OrderFilter): [Order!]! }
  type Subscription { orderUpdated(id: ID!): Order }
`

describe('схема GraphQL: загрузка и проверка документа без сети', () => {
  it('загружает схему из SDL, introspection-ответа endpoint и { __schema }', () => {
    const introspection = introspectionFromSchema(buildSchema(SDL))

    expect(loadGraphQLSchema(SDL)).toMatchObject({ format: 'sdl', diagnostics: [] })
    expect(loadGraphQLSchema({ data: introspection })).toMatchObject({ format: 'introspection', diagnostics: [] })
    expect(loadGraphQLSchema(introspection).schema?.getType('OrderFilter')).toBeTruthy()
    expect(loadGraphQLSchema(JSON.stringify({ data: introspection })).schema?.getQueryType()?.name).toBe('Query')
  })

  it('возвращает диагностики схемы вместо исключений', () => {
    expect(loadGraphQLSchema('type Query {').diagnostics[0]).toMatchObject({ code: 'graphql-schema-syntax', line: 1 })
    expect(loadGraphQLSchema('type Query { a: Missing }').diagnostics[0]).toMatchObject({ code: 'graphql-schema-invalid' })
    expect(loadGraphQLSchema('{ not json').diagnostics[0]).toMatchObject({ code: 'graphql-schema-introspection-json' })
    expect(loadGraphQLSchema({ data: null, errors: [{ message: 'Introspection disabled' }] }).diagnostics[0])
      .toMatchObject({ code: 'graphql-schema-introspection-errors', message: expect.stringContaining('Introspection disabled') })
    expect(loadGraphQLSchema({ foo: 1 } as never).diagnostics[0]).toMatchObject({ code: 'graphql-schema-introspection-shape' })
  })

  it('проверяет поля, аргументы и переменные документа по схеме с позициями', () => {
    const valid = 'query Load($id: ID!) { order(id: $id) { id status items(first: 2) } }'
    expect(validateGraphQLDocument(SDL, valid)).toEqual([])
    expect(validateGraphQLDocument(SDL, '   ')).toEqual([])

    const source = 'query Load($id: ID!) {\n  order(id: $id) { id missingField }\n}'
    const diagnostics = validateGraphQLDocument(SDL, source)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      code: 'graphql-document-validation',
      message: expect.stringContaining('missingField'),
      line: 2,
      column: 23,
      endLine: 2,
      endColumn: 35,
    })
    expect(source.slice(diagnostics[0]!.offset!, diagnostics[0]!.offset! + diagnostics[0]!.length!)).toBe('missingField')

    const wrongVariable = validateGraphQLDocument(SDL, 'query Load($id: String) { order(id: $id) { id } }')
    expect(wrongVariable[0]?.message).toContain('"$id" of type "String" used in position expecting type "ID!"')
    const undefinedVariable = validateGraphQLDocument(SDL, 'query { order(id: $id) { id } }')
    expect(undefinedVariable[0]?.message).toContain('Variable "$id" is not defined')
  })

  it('сообщает синтаксическую ошибку документа и ошибку схемы', () => {
    expect(validateGraphQLDocument(SDL, 'query { order(id: 1) { id }')[0])
      .toMatchObject({ code: 'graphql-document-syntax', line: 1 })
    expect(validateGraphQLDocument('type Query {', 'query { a }')[0]).toMatchObject({ code: 'graphql-schema-syntax' })
  })

  it('отдаёт текст introspection-запроса для загрузки схемы с endpoint', () => {
    const query = createGraphQLIntrospectionQuery()
    expect(query).toContain('__schema')
    expect(query).toContain('description')
    expect(createGraphQLIntrospectionQuery({ descriptions: false })).not.toContain('description')
  })
})

function graphQLQuery(document: string, variables?: string): string {
  return `defineQuery({
    kind: 'graphql',
    props: defineProps({ id: field('ID') }),
    request: {
      endpoint: 'https://graphql.example.test',
      document: gql\`${document}\`,
      ${variables ? `variables: ${variables},` : ''}
    },
    outputs: { item: output().from(data('item')) },
  })`
}

function graphQLStream(document: string, variables?: string): string {
  return `defineStream({
    props: defineProps({ orderId: field('ID') }),
    transport: graphqlSse({
      url: 'https://graphql.example.test/stream',
      document: gql\`${document}\`,
      ${variables ? `variables: ${variables},` : ''}
    }),
    events: { next: event('order.updated') },
  })`
}

describe('согласованность variables(...) с документом GraphQL без схемы', () => {
  it('query: error для недостающей обязательной переменной и warning для лишней', () => {
    const result = compileQuerySource(graphQLQuery(
      'query Load($id: ID!, $limit: Int!, $offset: Int = 0, $tag: String) { item(id: $id) { id } }',
      'variables(({ prop }) => ({ id: prop(\'id\'), extra: 1 }))',
    ))

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        code: 'query-source-graphql-variable-unknown',
        sourcePath: 'request.variables',
        message: expect.stringContaining('"extra"'),
      }),
      expect.objectContaining({
        severity: 'error',
        code: 'query-source-graphql-variable-missing',
        sourcePath: 'request.variables',
        message: expect.stringContaining('$limit'),
      }),
    ])
  })

  it('query: без variables(...) обязательные переменные документа — ошибка; согласованный набор — без диагностик', () => {
    const missing = compileQuerySource(graphQLQuery('query Load($id: ID!) { item(id: $id) { id } }'))
    expect(missing.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'query-source-graphql-variable-missing' }),
    ])

    const consistent = compileQuerySource(graphQLQuery(
      'query Load($id: ID!, $limit: Int) { item(id: $id) { id } }',
      'variables(({ prop }) => ({ id: prop(\'id\') }))',
    ))
    expect(consistent.diagnostics).toEqual([])
  })

  it('query: проверяет выбранную operationName и пропускает вычисляемый объект variables', () => {
    const named = compileQuerySource(`defineQuery({
      kind: 'graphql',
      request: {
        endpoint: 'https://graphql.example.test',
        operationName: 'Second',
        document: gql\`query First($a: ID!) { item(id: $a) { id } } query Second($b: ID!) { item(id: $b) { id } }\`,
        variables: variables(() => ({ a: '1' })),
      },
      outputs: { item: output().from(data('item')) },
    })`)
    expect(named.diagnostics.map(item => item.code)).toEqual([
      'query-source-graphql-variable-unknown',
      'query-source-graphql-variable-missing',
    ])
    expect(named.diagnostics[1]?.message).toContain('$b')

    const dynamic = compileQuerySource(graphQLQuery(
      'query Load($id: ID!) { item(id: $id) { id } }',
      'variables(({ prop }) => prop(\'id\'))',
    ))
    expect(dynamic.diagnostics.filter(item => item.code.includes('graphql-variable'))).toEqual([])
  })

  it('stream graphqlSse: те же правила с кодами stream и путём transport.variables', () => {
    const result = compileStreamSource(graphQLStream(
      'subscription OrderUpdated($id: ID!, $tenant: String!) { orderUpdated(id: $id) { id } }',
      'variables(({ prop }) => ({ id: prop(\'orderId\'), region: \'eu\' }))',
    ))

    expect(result.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'stream-graphql-variable-unknown', sourcePath: 'transport.variables' }),
      expect.objectContaining({ severity: 'error', code: 'stream-graphql-variable-missing', sourcePath: 'transport.variables' }),
    ])
    expect(result.artifact).toBeNull()

    const consistent = compileStreamSource(graphQLStream(
      'subscription OrderUpdated($id: ID!) { orderUpdated(id: $id) { id } }',
      'variables(({ prop }) => ({ id: prop(\'orderId\') }))',
    ))
    expect(consistent.diagnostics).toEqual([])
  })
})
