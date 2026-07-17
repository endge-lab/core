import { describe, expect, it } from 'vitest'

import { Endge } from '@/model/endge/kernel/endge'

describe('source document references', () => {
  it.each([
    ['composition', "style('default')", 'default', 'style'],
    ['composition', "composition('groundhandling-control-page')", 'groundhandling-control-page', 'composition'],
    ['composition', "query('load-flights')", 'load-flights', 'query'],
    ['composition', "filterView('flight-filter')", 'flight-filter', 'filter'],
    ['composition', "filterView('flight-filter').component('compact-filter')", 'compact-filter', 'component'],
    ['query', "dataView('normalize-flight')", 'normalize-flight', 'data-view'],
    ['query', "output().from('raw').dataView('normalize-flight')", 'normalize-flight', 'data-view'],
    ['query', "filter('flight-filter')", 'flight-filter', 'filter'],
    ['query', "{ auth: { mode: 'profile', profile: 'keycloak-dev' } }", 'keycloak-dev', 'auth-profile'],
    ['data-view', "dataView('normalize-flight')", 'normalize-flight', 'data-view'],
    ['data-view', "from('items').dataView('normalize-flight')", 'normalize-flight', 'data-view'],
    ['data-view', "path('item.std').convert('date.iso_to_time')", 'date.iso_to_time', 'converter'],
    ['data-view', "path('item.std').convert(converter('date.iso_to_time'))", 'date.iso_to_time', 'converter'],
    ['store', "mock('flight-list')", 'flight-list', 'mock'],
    ['store', "dataView('normalize-flight')", 'normalize-flight', 'data-view'],
    ['store', "derived().from('raw').dataView('normalize-flight')", 'normalize-flight', 'data-view'],
    ['filter', "field('String').vocab('airports')", 'airports', 'vocabs'],
    ['computation', "computation('calculate-duration', {})", 'calculate-duration', 'computation'],
  ] as const)('resolves %s reference %s', (sourceKind, expression, identity, target) => {
    const source = `const value = ${expression}`
    const reference = Endge.source.referenceAt(sourceKind, contextAt(source, identity))

    expect(reference).toMatchObject({ identity, target })
    expect(source.slice(reference!.range.start, reference!.range.end)).toContain(identity)
  })

  it('resolves a reference when the cursor is on the DSL constructor', () => {
    const source = "const page = composition('groundhandling-control-page').activateOn(startup())"

    expect(Endge.source.referenceAt('composition', contextAt(source, 'composition'))).toMatchObject({
      target: 'composition',
      identity: 'groundhandling-control-page',
    })
  })

  it('chooses the nested external reference instead of its wrapping method call', () => {
    const source = "from('items').dataView(dataView('normalize-flight')).as('item')"

    expect(Endge.source.referenceAt('data-view', contextAt(source, 'normalize-flight'))).toMatchObject({
      target: 'data-view',
      identity: 'normalize-flight',
    })
  })

  it.each([
    ['composition', "fromStore('flight-store.rows')", 'flight-store'],
    ['query', "response('items')", 'items'],
    ['data-view', "path('item.id')", 'item.id'],
    ['store', "from('raw')", 'raw'],
  ] as const)('does not treat internal %s expression as a document reference', (sourceKind, source, cursor) => {
    expect(Endge.source.referenceAt(sourceKind, contextAt(source, cursor))).toBeNull()
  })

  it('returns null when the source is temporarily invalid', () => {
    const source = "composition('unfinished"
    expect(Endge.source.referenceAt('composition', contextAt(source, 'unfinished'))).toBeNull()
  })
})

function contextAt(source: string, needle: string): {
  source: string
  position: { lineNumber: number, column: number }
} {
  const offset = source.indexOf(needle)
  if (offset < 0)
    throw new Error(`Needle not found: ${needle}`)
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
