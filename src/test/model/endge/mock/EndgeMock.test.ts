import { afterEach, describe, expect, it } from 'vitest'

import { RMock } from '@/domain/entities/reflect/RMock'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeMock } from '@/model/endge/mock/EndgeMock'

describe('EndgeMock', () => {
  afterEach(() => {
    Endge.domain.reset()
    Endge.mock.reset()
  })

  it('reads JSON from a persisted RMock and returns an independent copy', () => {
    const registry = new EndgeMock()
    Endge.domain.addMock(makeMock({
      identity: 'test.rows',
      source: '{"rows":[{"id":1}]}',
    }))

    const first = registry.get<{ rows: Array<{ id: number }> }>('test.rows')
    first.rows[0]!.id = 2

    expect(registry.get('test.rows')).toEqual({ rows: [{ id: 1 }] })
  })

  it('connects a persisted RMock to a code provider', () => {
    const registry = new EndgeMock()
    Endge.domain.addMock(makeMock({
      identity: 'test.provider',
      contentSource: 'code-provider',
      codeRef: '@test:mocks.rows',
    }))
    registry.registerProvider({
      ref: '@test:mocks.rows',
      provide: () => ({ rows: [1, 2] }),
    })

    expect(registry.getBindingStatus('test.provider')).toBe('connected')
    expect(registry.get('test.provider')).toEqual({ rows: [1, 2] })
  })

  it('starts without hidden builtin providers', () => {
    const registry = new EndgeMock()

    expect(registry.listProviders()).toEqual([])
    expect(registry.getBindingStatus('groundhandling')).toBe('missing-document')
  })
})

function makeMock(input: Partial<RMock> & { identity: string }): RMock {
  const mock = new RMock()
  mock.id = Math.floor(Math.random() * 100000) + 1
  mock.identity = input.identity
  mock.name = input.identity
  mock.displayName = input.identity
  mock.contentSource = input.contentSource ?? 'document'
  mock.contentType = input.contentType ?? 'application/json'
  mock.source = input.source ?? '{}'
  mock.codeRef = input.codeRef ?? null
  return mock
}
