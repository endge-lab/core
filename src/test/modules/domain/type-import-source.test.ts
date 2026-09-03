import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/kernel/endge'

describe('type importers', () => {
  afterEach(() => Endge.domain.reset())

  it('writes OpenAPI fields to canonical Type Source', () => {
    Endge.domain.mergeYamlOpenApi(`
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
`)

    const type = Endge.domain.getType('Customer')
    const compiled = Endge.source.compile('type', type?.source ?? '')
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

  it('writes GraphQL nullability and custom references to Type Source', () => {
    Endge.domain.mergeGraphQL(`
      type Customer { id: ID!, orders: [Order!]! }
      type Order { number: String!, note: String }
      type Query { customer: Customer }
    `)

    const customer = Endge.domain.getType('Customer')
    const compiled = Endge.source.compile('type', customer?.source ?? '')
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
