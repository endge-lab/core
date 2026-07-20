import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/model/endge/kernel/endge'
import { importGqlSchemaToDomain } from '@/tools/graphql-parser'
import { importOpenApiSchemaToDomain } from '@/tools/openapi-parser'

describe('type importers', () => {
  afterEach(() => Endge.domain.reset())

  it('writes OpenAPI fields to canonical source and keeps legacy fields', () => {
    importOpenApiSchemaToDomain(`
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
    expect(type?.fields.size).toBe(3)
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
    importGqlSchemaToDomain(`
      type Customer { id: ID!, orders: [Order!]! }
      type Order { number: String!, note: String }
      type Query { customer: Customer }
    `)

    const customer = Endge.domain.getType('Customer')
    const compiled = Endge.source.compile('type', customer?.source ?? '')
    expect(customer?.fields.size).toBe(2)
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
