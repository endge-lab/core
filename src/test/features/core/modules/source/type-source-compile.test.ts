import { describe, expect, it } from 'vitest'

import { compileTypeSource } from '@/features/core/modules/source/services/compilers/type-source-compile'
import { TypeSourceLanguageStrategy } from '@/features/core/modules/source/services/strategies/TypeSourceLanguageStrategy'
import { serializeTypeSourceDocument } from '@/features/core/modules/source/services/type-source-serialize'

describe('компилятор Source типа', () => {
  it('компилирует объектный тип с модификаторами полей', () => {
    const result = compileTypeSource(`defineType({
      identity: field(String)
        .description('Passenger profile identifier'),
      displayName: field(String),
      forecastFactorTotal: field(Number)
        .min(0)
        .max(1)
        .example(0.7),
      flightFilters: field(FlightFilter)
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
      `defineType(unionOf(ArrivalFlight, DepartureFlight))`,
      {
        kind: 'union',
        variants: [
          { kind: 'reference', identity: 'ArrivalFlight' },
          { kind: 'reference', identity: 'DepartureFlight' },
        ],
      },
    ],
    [
      `defineType(arrayOf(Flight))`,
      { kind: 'array', items: { kind: 'reference', identity: 'Flight' } },
    ],
  ])('компилирует поддерживаемые корневые формы', (source, expected) => {
    const result = compileTypeSource(source)
    expect(result.diagnostics).toEqual([])
    expect(result.document?.definition).toEqual(expected)
  })

  it('компилирует рекурсивные inline-выражения объектов', () => {
    const result = compileTypeSource(`defineType({
      id: field(ID),
      delivery: field(objectOf({
        method: field(String),
        address: field(objectOf({
          city: field(String),
          coordinates: field(objectOf({
            latitude: field(Number).min(-90).max(90),
            longitude: field(Number).min(-180).max(180),
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

  it('разрешает inline-определения в unionOf и arrayOf', () => {
    const result = compileTypeSource(`defineType(unionOf(
      SavedAddress,
      objectOf({
        label: field(String),
        points: field(arrayOf(objectOf({
          x: field(Number),
          y: field(Number),
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

  it('принимает пустой Source для немигрированного legacy-типа', () => {
    expect(compileTypeSource('')).toEqual({
      ast: null,
      document: null,
      artifact: null,
      diagnostics: [],
    })
  })

  it('сохраняет ссылки в кавычках как обратно совместимую альтернативу', () => {
    const result = compileTypeSource(`defineType({
      customer: field('Customer'),
      items: field(arrayOf(type('LineItem'))),
    })`)

    expect(result.diagnostics).toEqual([])
    expect(result.document?.definition).toMatchObject({
      fields: [
        { type: { kind: 'reference', identity: 'Customer' } },
        { type: { kind: 'array', items: { kind: 'reference', identity: 'LineItem' } } },
      ],
    })
  })

  it('сериализует именованные ссылки в каноническом синтаксисе без кавычек', () => {
    const result = compileTypeSource(`defineType(unionOf(type('ArrivalFlight'), type('vendor:DepartureFlight')))`)

    expect(serializeTypeSourceDocument(result.document!)).toBe(`defineType(unionOf(
  ArrivalFlight,
  type('vendor:DepartureFlight'),
))
`)
  })

  it('отклоняет исполняемые выражения и неподдерживаемые модификаторы', () => {
    const result = compileTypeSource(`defineType({
      name: field(resolveType()).nullable(),
    })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'type-source-field-modifier-unsupported',
      'type-source-definition',
    ]))
  })

  it('требует objectOf вокруг вложенных объектных литералов и отклоняет range-модификаторы объектов', () => {
    const result = compileTypeSource(`defineType({
      invalidShape: field({ value: field(String) }),
      invalidRange: field(objectOf({ value: field(Number) })).min(0),
    })`)

    expect(result.artifact).toBeNull()
    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'type-source-object-wrapper',
      'type-source-field-range-type',
    ]))
  })

  it('разрешает ссылки на поля и типы для навигации редактора', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const source = `defineType(arrayOf(Flight))`
    const reference = strategy.resolveReference({
      source,
      position: { lineNumber: 1, column: source.indexOf('Flight') + 2 },
    })

    expect(reference).toMatchObject({ target: 'type', identity: 'Flight' })
  })

  it('разрешает ссылки, вложенные в objectOf', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const source = `defineType({ delivery: field(objectOf({ customer: field(Customer) })) })`
    const reference = strategy.resolveReference({
      source,
      position: { lineNumber: 1, column: source.indexOf('Customer') + 2 },
    })

    expect(reference).toMatchObject({ target: 'type', identity: 'Customer' })
  })

  it('предлагает символы Type Registry на основе Source', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const completions = strategy.completions({
      source: `defineType({ customer: field(Customer) })`,
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

  it('сообщает об отсутствующих ссылках реестра и разрешает Any с предупреждением', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const result = strategy.validate(`defineType({
      unknown: field(MissingType),
      metadata: field(Any),
    })`, {
      source: '',
      typeSymbols: [{ identity: 'String', category: 'primitive' }],
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'type-reference-missing', severity: 'error', start: expect.any(Number), end: expect.any(Number) }),
      expect.objectContaining({ code: 'type-any-usage', severity: 'warning' }),
    ]))
  })

  it('возвращает подсветку разрешённых и неразрешённых семантических типов', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const source = `defineType({ known: field(Flight), primitive: field(String), missing: field(MissingType) })`

    expect(strategy.semanticHighlights({
      source,
      typeSymbols: [
        { identity: 'Flight', category: 'user' },
        { identity: 'String', category: 'primitive' },
      ],
    })).toEqual([
      expect.objectContaining({ identity: 'Flight', status: 'resolved' }),
      expect.objectContaining({ identity: 'MissingType', status: 'unresolved' }),
    ])
  })
})
