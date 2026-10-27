import type { SourceContextValues } from '@/features/core/modules/source/domain/types/source-context.types'

import { parseExpression } from '@babel/parser'

import { describe, expect, it } from 'vitest'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { compileValueExpression } from '@/features/core/modules/source/services/compilers/source-expression-compile'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { createGraphQLDocumentVariants, validateGraphQLDocumentVariants } from '@/features/core/modules/source/services/graphql-fragments'
import { runWithSourceContext } from '@/features/core/modules/source/services/source-context'

const AFL: SourceContextValues = { facets: { tenant: 'afl' }, config: {}, knownFacets: ['tenant'] }
const KZN: SourceContextValues = { facets: { tenant: 'kzn' }, config: {}, knownFacets: ['tenant'] }

const SCHEMA = `
  type Flight { id: ID!, gate: String, stand: String, crew(limit: Int): [String] }
  type Query { flight(id: ID!): Flight }
  type Subscription { flightChanged(id: ID!): Flight }
`

function query(fragments: string, document = 'query Flight($id: ID!) { flight(id: $id) { ...FlightFields } }', variables = `variables(({ prop }) => ({ id: prop('id') }))`): string {
  return `defineQuery({
    kind: 'graphql',
    props: defineProps({ id: field('String') }),
    request: {
      endpoint: 'https://ops.example.test/graphql',
      document: gql\`${document}\`,
      ${fragments}
      variables: ${variables},
    },
    outputs: { flight: output().from(response('flight')) },
  })`
}

const SWITCHED = `fragments: {
  FlightFields: contextSwitch({
    default: gql\`fragment FlightFields on Flight { id gate }\`,
    cases: [{ when: { tenant: 'kzn' }, use: gql\`fragment FlightFields on Flight { id stand }\` }],
  }),
},`

function codes(result: { diagnostics: Array<{ code: string, severity: string }> }, severity?: string): string[] {
  return result.diagnostics.filter(item => !severity || item.severity === severity).map(item => item.code)
}

describe('фрагменты GraphQL в Query и Stream', () => {
  it('подставляет вариант фрагмента по фасету сборки', () => {
    const afl = runWithSourceContext(AFL, () => compileQuerySource(query(SWITCHED)))
    const kzn = runWithSourceContext(KZN, () => compileQuerySource(query(SWITCHED)))
    expect(codes(afl, 'error')).toEqual([])
    expect(afl.artifact?.query).toContain('fragment FlightFields on Flight { id gate }')
    expect(afl.artifact?.query).not.toContain('stand')
    expect(kzn.artifact?.query).toContain('fragment FlightFields on Flight { id stand }')
    expect(kzn.artifact?.query).toContain('query Flight($id: ID!)')
    const document = kzn.document?.kind === 'graphql' ? kzn.document.request : null
    expect(document?.fragments?.operation).not.toContain('fragment FlightFields')
    expect(document?.fragments?.fragments.FlightFields?.selected).toBe(1)
  })

  it('вне сборки берёт default и сообщает info', () => {
    const result = compileQuerySource(query(SWITCHED))
    expect(codes(result, 'error')).toEqual([])
    expect(codes(result)).toContain('source-expression-context-unbound')
    expect(result.artifact?.query).toContain('id gate')
  })

  it('добавляет вложенные фрагменты и не добавляет неиспользуемые', () => {
    const result = compileQuerySource(query(`fragments: {
      FlightFields: gql\`fragment FlightFields on Flight { id ...Crew }\`,
      Crew: gql\`fragment Crew on Flight { crew }\`,
      Unused: gql\`fragment Unused on Flight { gate }\`,
    },`))
    expect(codes(result, 'error')).toEqual([])
    expect(codes(result, 'warning')).toEqual(['query-source-graphql-fragment-unused'])
    expect(result.artifact?.query).toContain('fragment Crew on Flight')
    expect(result.artifact?.query).not.toContain('fragment Unused')
  })

  it('ошибки: spread без определения, дубль с document, имя, форма, переменные', () => {
    const missing = compileQuerySource(query(''))
    expect(codes(missing, 'error')).toContain('query-source-graphql-fragment-undefined')

    const duplicate = compileQuerySource(query(
      `fragments: { FlightFields: gql\`fragment FlightFields on Flight { id }\` },`,
      'query Flight($id: ID!) { flight(id: $id) { ...FlightFields } } fragment FlightFields on Flight { gate }',
    ))
    expect(codes(duplicate, 'error')).toContain('query-source-graphql-fragment-duplicate')

    const name = compileQuerySource(query(`fragments: { FlightFields: gql\`fragment Other on Flight { id }\` },`))
    expect(codes(name, 'error')).toContain('query-source-graphql-fragment-name')

    const shape = compileQuerySource(query(`fragments: { FlightFields: gql\`query X { a }\` },`))
    expect(codes(shape, 'error')).toContain('query-source-graphql-fragment-shape')

    const notObject = compileQuerySource(query(`fragments: [gql\`fragment FlightFields on Flight { id }\`],`))
    expect(codes(notObject, 'error')).toContain('query-source-graphql-fragments-shape')
    const spread = compileQuerySource(query(`fragments: { ...other },`))
    expect(codes(spread, 'error')).toContain('query-source-graphql-fragments-shape')

    const invalid = compileQuerySource(query(`fragments: { FlightFields: gql\`fragment FlightFields on {\` },`))
    expect(codes(invalid, 'error')).toContain('query-source-graphql-fragment-invalid')

    const variable = compileQuerySource(query(`fragments: {
      FlightFields: contextSwitch({
        default: gql\`fragment FlightFields on Flight { id }\`,
        cases: [{ when: { tenant: 'kzn' }, use: gql\`fragment FlightFields on Flight { crew(limit: $limit) }\` }],
      }),
    },`))
    expect(codes(variable, 'error')).toContain('query-source-graphql-fragment-variable-undeclared')

    const nested = compileQuerySource(query(`fragments: { FlightFields: gql\`fragment FlightFields on Flight { ...Missing }\` },`))
    expect(codes(nested, 'error')).toContain('query-source-graphql-fragment-undefined')

    const rest = compileQuerySource(`defineQuery({ kind: 'rest', request: { endpoint: '/x', fragments: {} } })`)
    expect(codes(rest, 'error')).toContain('query-source-request-property-unsupported')
  })

  it('проверяет все ветки contextSwitch, даже невыбранные', () => {
    const result = runWithSourceContext(AFL, () => compileQuerySource(query(`fragments: {
      FlightFields: contextSwitch({
        default: gql\`fragment FlightFields on Flight { id }\`,
        cases: [{ when: { tenant: 'kzn' }, use: gql\`fragment Wrong on Flight { id }\` }],
      }),
    },`)))
    expect(codes(result, 'error')).toContain('query-source-graphql-fragment-name')
  })

  it('возвращает document каждого варианта и проверяет их по схеме', () => {
    const compiled = compileQuerySource(query(`fragments: {
      FlightFields: contextSwitch({
        default: gql\`fragment FlightFields on Flight { id gate }\`,
        cases: [{ when: { tenant: 'kzn' }, use: gql\`fragment FlightFields on Flight { id parking }\` }],
      }),
    },`))
    const fragments = compiled.document?.kind === 'graphql' ? compiled.document.request.fragments : undefined
    expect(fragments).toBeDefined()
    const variants = createGraphQLDocumentVariants(fragments!)
    expect(variants.map(item => item.context)).toEqual([{}, { tenant: 'kzn' }])
    const checked = validateGraphQLDocumentVariants(SCHEMA, fragments!)
    expect(checked[0]!.diagnostics).toEqual([])
    expect(checked[1]!.diagnostics.map(item => item.code)).toContain('graphql-document-validation')
    expect(checked[1]!.diagnostics[0]!.message).toContain('parking')
  })

  it('stream graphqlSse: подстановка по фасету, в artifact только итоговый document', () => {
    const source = `defineStream({
      props: defineProps({ id: field('String') }),
      transport: graphqlSse({
        url: 'https://ops.example.test/graphql/stream',
        document: gql\`subscription Changed($id: ID!) { flightChanged(id: $id) { ...FlightFields } }\`,
        ${SWITCHED}
        variables: variables(({ prop }) => ({ id: prop('id') })),
      }),
      events: { next: event({ type: 'flight.changed', payloadFrom: 'flightChanged' }) },
    })`
    const result = runWithSourceContext(KZN, () => compileStreamSource(source))
    expect(codes(result, 'error')).toEqual([])
    const transport = result.artifact?.transport
    expect(transport?.kind === 'graphql-sse' && transport.document).toContain('id stand')
    expect(transport && 'fragments' in transport).toBe(false)
    expect(result.document?.transport.kind === 'graphql-sse' && result.document.transport.fragments).toBeTruthy()
  })
})

describe('facet() с неизвестным фасетом', () => {
  it('предупреждает, если фасет не объявлен в домене', () => {
    const diagnostics: any[] = []
    runWithSourceContext(AFL, () => compileValueExpression(parseExpression(`facet('tenat')`) as any, diagnostics, 'value'))
    expect(diagnostics.map(item => item.code)).toEqual(['source-expression-facet-unknown'])
    const known: any[] = []
    runWithSourceContext(AFL, () => compileValueExpression(parseExpression(`facet('tenant')`) as any, known, 'value'))
    expect(known).toEqual([])
  })
})
