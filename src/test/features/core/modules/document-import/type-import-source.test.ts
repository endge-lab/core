import { buildSchema, introspectionFromSchema } from 'graphql'
import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'

describe('импортёры Type', () => {
  afterEach(() => {
    Endge.documentImport.reset()
    Endge.domain.reset()
  })

  it('подготавливает поля OpenAPI как канонический Type Source без изменения Domain', () => {
    const plan = Endge.documentImport.prepare({
      format: 'openapi',
      source: `
openapi: 3.0.0
components:
  schemas:
    Customer:
      type: object
      required: [id, address]
      properties:
        id: { type: string }
        address:
          type: object
          properties:
            city: { type: string }
        tags:
          type: array
          items: { type: string }
`,
    })

    const candidate = plan.candidates.find(item => item.identity === 'Customer')
    const compiled = Endge.source.compile('type', candidate?.sourcePreview ?? '')
    expect(Endge.domain.getType('Customer')).toBeNull()
    expect(candidate).toMatchObject({ status: 'ready', summary: { fields: 3, requiredFields: 2 } })
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.document).toMatchObject({
      definition: {
        kind: 'object',
        fields: [
          { key: 'id', optional: false },
          { key: 'address', type: { kind: 'object' } },
          { key: 'tags', array: true, optional: true },
        ],
      },
    })
  })

  it('нормализует primitive aliases OpenAPI и сохраняет enum как импортируемый Type', () => {
    const plan = Endge.documentImport.prepare({
      format: 'openapi',
      source: `
openapi: 3.0.0
components:
  schemas:
    Duration:
      type: string
    Instant:
      type: string
      format: date-time
    LocalTime:
      type: string
      format: time
    Priority:
      type: integer
    ConnexColor:
      type: string
      enum: [BLUE, GREEN, RED]
    Event:
      type: object
      properties:
        duration: { $ref: '#/components/schemas/Duration' }
        instant: { $ref: '#/components/schemas/Instant' }
        localTime: { $ref: '#/components/schemas/LocalTime' }
        priority: { $ref: '#/components/schemas/Priority' }
        color: { $ref: '#/components/schemas/ConnexColor' }
`,
    })

    expect(plan.skipped).toEqual([])
    expect(plan.candidates.map(item => item.identity)).toEqual(['ConnexColor', 'Event'])

    const enumCandidate = plan.candidates.find(item => item.identity === 'ConnexColor')
    const enumCompiled = Endge.source.compile('type', enumCandidate?.sourcePreview ?? '')
    expect(enumCompiled.document).toMatchObject({
      definition: { kind: 'enum', values: ['BLUE', 'GREEN', 'RED'] },
    })

    const eventCandidate = plan.candidates.find(item => item.identity === 'Event')
    const eventCompiled = Endge.source.compile('type', eventCandidate?.sourcePreview ?? '')
    expect(eventCompiled.document).toMatchObject({
      definition: {
        fields: [
          { key: 'duration', type: { identity: 'String' } },
          { key: 'instant', type: { identity: 'DateTime' } },
          { key: 'localTime', type: { identity: 'Time' } },
          { key: 'priority', type: { identity: 'Number' } },
          { key: 'color', type: { identity: 'ConnexColor' } },
        ],
      },
    })
  })

  it('подготавливает nullability GraphQL и пользовательские ссылки без корней операций', () => {
    const plan = Endge.documentImport.prepare({
      format: 'graphql',
      source: `
      type Customer { id: ID!, orders: [Order!]! }
      type Order { number: String!, note: String }
      type Query { customer: Customer }
    `,
    })

    const customer = plan.candidates.find(item => item.identity === 'Customer')
    const compiled = Endge.source.compile('type', customer?.sourcePreview ?? '')
    expect(plan.candidates.map(item => item.identity)).toEqual(['Customer', 'Order'])
    expect(plan.skipped).toContainEqual(expect.objectContaining({ identity: 'Query' }))
    expect(compiled.document).toMatchObject({
      definition: {
        fields: [
          { key: 'id', type: { identity: 'ID' }, optional: false },
          { key: 'orders', type: { identity: 'Order' }, array: true, optional: false },
        ],
      },
    })
  })

  it('нормализует GraphQL scalars и импортирует enum definitions', () => {
    const plan = Endge.documentImport.prepare({
      format: 'graphql',
      source: `
      scalar Duration
      scalar Instant
      scalar LocalTime
      scalar BigDecimal
      scalar JSON
      scalar ExternalValue

      enum ItemStatus { ADD REMOVE UPDATE }

      type Event {
        duration: Duration
        instant: Instant!
        localTime: LocalTime
        amount: BigDecimal
        payload: JSON
        external: ExternalValue
        status: ItemStatus!
      }
    `,
    })

    expect(plan.skipped).toEqual([])
    expect(plan.candidates.map(item => item.identity)).toEqual(['ItemStatus', 'Event'])
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: 'document-import-graphql-scalar-fallback',
      severity: 'warning',
    }))

    const eventCandidate = plan.candidates.find(item => item.identity === 'Event')
    const eventCompiled = Endge.source.compile('type', eventCandidate?.sourcePreview ?? '')
    expect(eventCompiled.document).toMatchObject({
      definition: {
        fields: [
          { key: 'duration', type: { identity: 'String' } },
          { key: 'instant', type: { identity: 'DateTime' } },
          { key: 'localTime', type: { identity: 'Time' } },
          { key: 'amount', type: { identity: 'Number' } },
          { key: 'payload', type: { identity: 'JSON' } },
          { key: 'external', type: { identity: 'Any' } },
          { key: 'status', type: { identity: 'ItemStatus' } },
        ],
      },
    })
  })

  it('импортирует input, interface и union GraphQL с пометкой в metadata', () => {
    const plan = Endge.documentImport.prepare({
      format: 'graphql',
      source: `
      interface Node { id: ID! }
      interface Timestamped { updatedAt: String }
      type Order implements Node & Timestamped { id: ID!, updatedAt: String, matrix: [[Int!]!], lines(first: Int): [String!]! }
      type Refund implements Node { id: ID! }
      union Payment = Order | Refund
      union Lonely = Order
      input OrderFilter { status: String!, limit: Int! = 10, tags: [String!] = ["a"] }
      type Query { orders(filter: OrderFilter): [Order!]! }
    `,
    })

    expect(plan.candidates.map(item => item.identity)).toEqual(['Node', 'Timestamped', 'Order', 'Refund', 'Payment', 'OrderFilter'])
    expect(plan.candidates.every(item => item.status === 'ready')).toBe(true)
    expect(plan.skipped).toContainEqual(expect.objectContaining({ identity: 'Lonely', reason: expect.stringContaining('unionOf') }))

    const compile = (identity: string) => Endge.source.compile('type', plan.candidates.find(item => item.identity === identity)?.sourcePreview ?? '')

    const node = compile('Node')
    expect(node.diagnostics).toEqual([])
    expect(node.metadata).toEqual({ graphql: { kind: 'interface', implementations: ['Order', 'Refund'] } })
    expect(node.document).toMatchObject({ definition: { kind: 'object', fields: [{ key: 'id', optional: false }] } })

    const order = compile('Order')
    expect(order.metadata).toEqual({ graphql: { kind: 'object', interfaces: ['Node', 'Timestamped'] } })
    expect(order.document).toMatchObject({
      definition: {
        fields: [
          { key: 'id' },
          { key: 'updatedAt', optional: true },
          { key: 'matrix', array: true, optional: true, type: { kind: 'array', items: { kind: 'reference', identity: 'Number' } } },
          { key: 'lines', array: true, optional: false },
        ],
      },
    })
    expect(plan.candidates.find(item => item.identity === 'Order')?.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'info',
      code: 'document-import-graphql-field-arguments',
      message: expect.stringContaining('lines'),
    }))

    const payment = compile('Payment')
    expect(payment.diagnostics).toEqual([])
    expect(payment.metadata).toEqual({ graphql: { kind: 'union' } })
    expect(payment.document).toMatchObject({
      definition: { kind: 'union', variants: [{ identity: 'Order' }, { identity: 'Refund' }] },
    })

    const filter = compile('OrderFilter')
    expect(filter.diagnostics).toEqual([])
    expect(filter.metadata).toEqual({ graphql: { kind: 'input', defaults: { limit: 10, tags: ['a'] } } })
    expect(filter.document).toMatchObject({
      definition: {
        kind: 'object',
        fields: [
          { key: 'status', optional: false },
          { key: 'limit', optional: true },
          { key: 'tags', array: true, optional: true },
        ],
      },
    })
    expect(plan.candidates.find(item => item.identity === 'OrderFilter')?.summary).toEqual({ fields: 3, requiredFields: 1 })
  })

  it('импортирует Type из результата introspection так же, как из SDL', () => {
    const schema = buildSchema(`
      scalar DateTime
      """Заказ"""
      type Order { id: ID!, createdAt: DateTime!, status: Status }
      enum Status { NEW DONE }
      input OrderInput { id: ID! }
      type Query { order(id: ID!): Order }
    `)
    const introspection = introspectionFromSchema(schema)

    for (const source of [JSON.stringify({ data: introspection }), JSON.stringify(introspection)]) {
      const plan = Endge.documentImport.prepare({ format: 'graphql', source })
      expect(plan.diagnostics).toEqual([])
      expect(plan.candidates.map(item => item.identity).sort()).toEqual(['Order', 'OrderInput', 'Status'])
      expect(plan.skipped).toContainEqual(expect.objectContaining({ identity: 'Query', kind: 'graphql-operation-root' }))
      const order = plan.candidates.find(item => item.identity === 'Order')
      expect(order).toMatchObject({ status: 'ready', description: 'Заказ' })
      expect(Endge.source.compile('type', order?.sourcePreview ?? '').document).toMatchObject({
        definition: {
          fields: [
            { key: 'id', type: { identity: 'ID' } },
            { key: 'createdAt', type: { identity: 'DateTime' }, optional: false },
            { key: 'status', type: { identity: 'Status' }, optional: true },
          ],
        },
      })
    }
  })

  it('сообщает об ошибках introspection JSON без кандидатов', () => {
    const invalidJson = Endge.documentImport.prepare({ format: 'graphql', source: '{ "data": ' })
    expect(invalidJson.candidates).toEqual([])
    expect(invalidJson.diagnostics).toEqual([expect.objectContaining({ code: 'document-import-graphql-introspection-json', severity: 'error' })])

    const disabled = Endge.documentImport.prepare({
      format: 'graphql',
      source: JSON.stringify({ data: null, errors: [{ message: 'Introspection is disabled' }] }),
    })
    expect(disabled.diagnostics).toEqual([expect.objectContaining({
      code: 'document-import-graphql-introspection-invalid',
      message: expect.stringContaining('Introspection is disabled'),
    })])
  })
})
