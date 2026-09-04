import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/kernel/endge'

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
})
