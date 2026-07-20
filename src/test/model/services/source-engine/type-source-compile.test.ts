import { describe, expect, it } from 'vitest'

import { compileTypeSource } from '@/model/services/source-engine/compilers/type-source-compile'
import { TypeSourceLanguageStrategy } from '@/model/services/source-engine/strategies/TypeSourceLanguageStrategy'

describe('type source compiler', () => {
  it('compiles an object type with field modifiers', () => {
    const result = compileTypeSource(`defineType({
      identity: field('String')
        .description('Passenger profile identifier'),
      displayName: field('String'),
      forecastFactorTotal: field('Number')
        .min(0)
        .max(1)
        .example(0.7),
      flightFilters: field('FlightFilter')
        .array()
        .optional(),
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.document?.definition).toEqual({
      kind: 'object',
      fields: [
        {
          key: 'identity',
          type: { kind: 'reference', identity: 'String' },
          description: 'Passenger profile identifier',
          optional: false,
          array: false,
          examples: [],
        },
        {
          key: 'displayName',
          type: { kind: 'reference', identity: 'String' },
          optional: false,
          array: false,
          examples: [],
        },
        {
          key: 'forecastFactorTotal',
          type: { kind: 'reference', identity: 'Number' },
          optional: false,
          array: false,
          min: 0,
          max: 1,
          examples: [0.7],
        },
        {
          key: 'flightFilters',
          type: { kind: 'reference', identity: 'FlightFilter' },
          optional: true,
          array: true,
          examples: [],
        },
      ],
    })
  })

  it.each([
    [
      `defineType(enumOf(['draft', 'active', 'archived']))`,
      { kind: 'enum', values: ['draft', 'active', 'archived'] },
    ],
    [
      `defineType(unionOf(type('ArrivalFlight'), type('DepartureFlight')))`,
      {
        kind: 'union',
        variants: [
          { kind: 'reference', identity: 'ArrivalFlight' },
          { kind: 'reference', identity: 'DepartureFlight' },
        ],
      },
    ],
    [
      `defineType(arrayOf(type('Flight')))`,
      { kind: 'array', items: { kind: 'reference', identity: 'Flight' } },
    ],
  ])('compiles supported root forms', (source, expected) => {
    const result = compileTypeSource(source)
    expect(result.diagnostics).toEqual([])
    expect(result.document?.definition).toEqual(expected)
  })

  it('compiles recursive inline object expressions', () => {
    const result = compileTypeSource(`defineType({
      id: field('ID'),
      delivery: field(objectOf({
        method: field('String'),
        address: field(objectOf({
          city: field('String'),
          coordinates: field(objectOf({
            latitude: field('Number').min(-90).max(90),
            longitude: field('Number').min(-180).max(180),
          })),
        })),
      })).optional(),
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.document?.definition).toMatchObject({
      kind: 'object',
      fields: [
        { key: 'id', type: { kind: 'reference', identity: 'ID' } },
        {
          key: 'delivery',
          optional: true,
          type: {
            kind: 'object',
            fields: [
              { key: 'method', type: { kind: 'reference', identity: 'String' } },
              {
                key: 'address',
                type: {
                  kind: 'object',
                  fields: [
                    { key: 'city', type: { kind: 'reference', identity: 'String' } },
                    {
                      key: 'coordinates',
                      type: {
                        kind: 'object',
                        fields: [
                          { key: 'latitude', min: -90, max: 90 },
                          { key: 'longitude', min: -180, max: 180 },
                        ],
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    })
  })

  it('allows inline definitions in unionOf and arrayOf', () => {
    const result = compileTypeSource(`defineType(unionOf(
      type('SavedAddress'),
      objectOf({
        label: field('String'),
        points: field(arrayOf(objectOf({
          x: field('Number'),
          y: field('Number'),
        }))),
      }),
    ))`)

    expect(result.diagnostics).toEqual([])
    expect(result.document?.definition).toMatchObject({
      kind: 'union',
      variants: [
        { kind: 'reference', identity: 'SavedAddress' },
        {
          kind: 'object',
          fields: [
            { key: 'label', type: { kind: 'reference', identity: 'String' } },
            {
              key: 'points',
              type: {
                kind: 'array',
                items: { kind: 'object' },
              },
            },
          ],
        },
      ],
    })
  })

  it('accepts empty source for an unmigrated legacy type', () => {
    expect(compileTypeSource('')).toEqual({
      ast: null,
      document: null,
      artifact: null,
      diagnostics: [],
    })
  })

  it('rejects executable expressions and unsupported modifiers', () => {
    const result = compileTypeSource(`defineType({
      name: field(resolveType()).nullable(),
    })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'type-source-field-modifier-unsupported',
      'type-source-definition',
    ]))
  })

  it('requires objectOf around nested object literals and rejects range modifiers for objects', () => {
    const result = compileTypeSource(`defineType({
      invalidShape: field({ value: field('String') }),
      invalidRange: field(objectOf({ value: field('Number') })).min(0),
    })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'type-source-object-wrapper',
      'type-source-field-range-type',
    ]))
  })

  it('resolves field and type references for editor navigation', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const source = `defineType(arrayOf(type('Flight')))`
    const reference = strategy.resolveReference({
      source,
      position: { lineNumber: 1, column: source.indexOf('Flight') + 2 },
    })

    expect(reference).toMatchObject({ target: 'type', identity: 'Flight' })
  })

  it('resolves references nested inside objectOf', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const source = `defineType({ delivery: field(objectOf({ customer: field('Customer') })) })`
    const reference = strategy.resolveReference({
      source,
      position: { lineNumber: 1, column: source.indexOf('Customer') + 2 },
    })

    expect(reference).toMatchObject({ target: 'type', identity: 'Customer' })
  })

  it('offers source-backed Type Registry symbols', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const completions = strategy.completions({
      source: `defineType({ customer: field('') })`,
      ownerIdentity: 'Order',
      typeSymbols: [
        { identity: 'String', category: 'primitive' },
        { identity: 'Customer', displayName: 'Customer model', category: 'user' },
        { identity: 'Order', category: 'user' },
      ],
    })

    expect(completions).toContainEqual(expect.objectContaining({ label: 'Customer', detail: 'user type' }))
    expect(completions).not.toContainEqual(expect.objectContaining({ label: 'Order' }))
  })

  it('reports missing registry references and allows Any with a warning', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const result = strategy.validate(`defineType({
      unknown: field('MissingType'),
      metadata: field('Any'),
    })`, {
      source: '',
      typeSymbols: [{ identity: 'String', category: 'primitive' }],
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'type-reference-missing', severity: 'error' }),
      expect.objectContaining({ code: 'type-any-usage', severity: 'warning' }),
    ]))
  })
})
