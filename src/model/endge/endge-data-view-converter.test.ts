import { afterEach, describe, expect, it } from 'vitest'

import { RConverter } from '@/domain/entities/reflect/RConverter'
import { Endge } from '@/model/endge/endge'
import { EndgeDataView } from '@/model/endge/endge-data-view'

describe('EndgeDataView domain converters', () => {
  afterEach(() => Endge.domain.reset())

  it('uses a registered RConverter handler', () => {
    register('upper', value => String(value).toUpperCase())
    const output = new EndgeDataView().runSource(source('upper'), [{ id: 1, value: 'abc' }])
    expect(output).toEqual([{ id: 1, value: 'ABC' }])
  })

  it('rejects async converter handlers', () => {
    register('async', async value => value)
    expect(() => new EndgeDataView().runSource(source('async'), [{ id: 1, value: 'abc' }]))
      .toThrow('Async converter "async" is not supported')
  })
})

function register(identity: string, handler: (value: unknown) => unknown): void {
  const converter = new RConverter()
  converter.id = identity === 'upper' ? 1 : 2
  converter.identity = identity
  converter.name = identity
  converter.setCustom(handler)
  Endge.domain.addConverter(converter)
}

function source(converter: string): string {
  return `
defineDataView({
  mode: 'pipeline',
  steps: [
    from('').as('row'),
    map({
      id: path('row.id'),
      value: path('row.value').convert('${converter}'),
    }),
  ],
})
`
}
