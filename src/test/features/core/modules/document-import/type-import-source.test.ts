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
})
