import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/model/kernel/endge'
import { EndgeDataView } from '@/model/modules/runtime/execution/endge-data-view'

const disposers: VoidFunction[] = []

describe('EndgeDataView domain converters', () => {
  afterEach(() => {
    while (disposers.length) disposers.pop()?.()
  })

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
  const providerKey = `test.converter.${identity}`
  disposers.push(Endge.converters.define({
    identity,
    origin: { kind: 'local', owner: 'core-test' },
    defaultProviderKey: providerKey,
  }))
  disposers.push(Endge.converters.provide({
    identity,
    key: providerKey,
    origin: { kind: 'local', owner: 'core-test' },
    convert: handler,
  }))
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
