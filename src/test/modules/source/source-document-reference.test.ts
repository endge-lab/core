import { describe, expect, it } from 'vitest'

import { Endge } from '@/kernel/endge'

describe('ссылки документов Source', () => {
  it.each([
    ['composition', 'style(\'default\')', 'default', 'style'],
    ['composition', 'composition(\'groundhandling-control-page\')', 'groundhandling-control-page', 'composition'],
    ['composition', 'field(MyType)', 'MyType', 'type'],
    ['composition', 'query(\'load-flights\')', 'load-flights', 'query'],
    ['composition', 'mock(\'groundhandling-query-requirements\')', 'groundhandling-query-requirements', 'mock'],
    ['composition', 'filterView(\'flight-filter\')', 'flight-filter', 'filter'],
    ['composition', 'filterView(\'flight-filter\').component(\'compact-filter\')', 'compact-filter', 'component'],
    ['query', 'dataView(\'normalize-flight\')', 'normalize-flight', 'data-view'],
    ['query', 'output().from(\'raw\').dataView(\'normalize-flight\')', 'normalize-flight', 'data-view'],
    ['query', 'filter(\'flight-filter\')', 'flight-filter', 'filter'],
    ['query', 'field(MyType)', 'MyType', 'type'],
    ['query', '{ auth: { mode: \'profile\', profile: \'keycloak-dev\' } }', 'keycloak-dev', 'auth-profile'],
    ['data-view', 'dataView(\'normalize-flight\')', 'normalize-flight', 'data-view'],
    ['data-view', 'from(\'items\').dataView(\'normalize-flight\')', 'normalize-flight', 'data-view'],
    ['data-view', 'path(\'item.std\').convert(\'date.iso_to_time\')', 'date.iso_to_time', 'converter'],
    ['data-view', 'path(\'item.std\').convert(converter(\'date.iso_to_time\'))', 'date.iso_to_time', 'converter'],
    ['data-view', 'field(MyType)', 'MyType', 'type'],
    ['store', 'mock(\'flight-list\')', 'flight-list', 'mock'],
    ['store', 'dataView(\'normalize-flight\')', 'normalize-flight', 'data-view'],
    ['store', 'derived().from(\'raw\').dataView(\'normalize-flight\')', 'normalize-flight', 'data-view'],
    ['store', 'field(MyType)', 'MyType', 'type'],
    ['filter', 'field(\'String\').vocab(\'airports\')', 'airports', 'vocabs'],
    ['filter', 'field(MyType)', 'MyType', 'type'],
    ['computation', 'computation(\'calculate-duration\', {})', 'calculate-duration', 'computation'],
    ['computation', 'field(MyType)', 'MyType', 'type'],
  ] as const)('разрешает ссылку %s %s', (sourceKind, expression, identity, target) => {
    const source = `const value = ${expression}`
    const reference = Endge.source.referenceAt(sourceKind, contextAt(source, identity))

    expect(reference).toMatchObject({ identity, target })
    expect(source.slice(reference!.range.start, reference!.range.end)).toContain(identity)
  })

  it('разрешает ссылку, когда курсор находится на конструкторе DSL', () => {
    const source = 'const page = composition(\'groundhandling-control-page\').activateOn(startup())'

    expect(Endge.source.referenceAt('composition', contextAt(source, 'composition'))).toMatchObject({
      target: 'composition',
      identity: 'groundhandling-control-page',
    })
  })

  it('разрешает ссылку на тип, когда курсор находится на конструкторе поля', () => {
    const source = 'defineComposition({ props: defineProps({ value: field(MyType) }) })'

    expect(Endge.source.referenceAt('composition', contextAt(source, 'field'))).toMatchObject({
      target: 'type',
      identity: 'MyType',
    })
  })

  it.each([
    'composition',
    'query',
    'data-view',
    'store',
    'filter',
    'computation',
  ] as const)('подсвечивает открываемые ссылки на типы полей в Source %s', (sourceKind) => {
    const source = 'const contract = { external: field(Flight), primitive: field(String), missing: field(MissingType) }'
    const highlights = Endge.source.semanticHighlights(sourceKind, {
      source,
      typeSymbols: [
        { identity: 'Flight', category: 'user' },
        { identity: 'String', category: 'primitive' },
      ],
    })

    expect(highlights.map(highlight => ({
      identity: highlight.identity,
      status: highlight.status,
      source: source.slice(highlight.range.start, highlight.range.end),
    }))).toEqual([
      { identity: 'Flight', status: 'resolved', source: 'Flight' },
      { identity: 'MissingType', status: 'unresolved', source: 'MissingType' },
    ])
  })

  it('выбирает вложенную внешнюю ссылку вместо оборачивающего её вызова метода', () => {
    const source = 'from(\'items\').dataView(dataView(\'normalize-flight\')).as(\'item\')'

    expect(Endge.source.referenceAt('data-view', contextAt(source, 'normalize-flight'))).toMatchObject({
      target: 'data-view',
      identity: 'normalize-flight',
    })
  })

  it.each([
    ['composition', 'fromStore(\'flight-store.rows\')', 'flight-store'],
    ['query', 'response(\'items\')', 'items'],
    ['data-view', 'path(\'item.id\')', 'item.id'],
    ['store', 'from(\'raw\')', 'raw'],
  ] as const)('не считает внутреннее выражение %s ссылкой на документ', (sourceKind, source, cursor) => {
    expect(Endge.source.referenceAt(sourceKind, contextAt(source, cursor))).toBeNull()
  })

  it('возвращает null, когда Source временно некорректен', () => {
    const source = 'composition(\'unfinished'
    expect(Endge.source.referenceAt('composition', contextAt(source, 'unfinished'))).toBeNull()
  })
})

function contextAt(source: string, needle: string): {
  source: string
  position: { lineNumber: number, column: number }
} {
  const offset = source.indexOf(needle)
  if (offset < 0) {
    throw new Error(`Needle not found: ${needle}`)
  }
  const before = source.slice(0, offset + Math.floor(needle.length / 2))
  const lines = before.split('\n')
  return {
    source,
    position: {
      lineNumber: lines.length,
      column: (lines.at(-1)?.length ?? 0) + 1,
    },
  }
}
