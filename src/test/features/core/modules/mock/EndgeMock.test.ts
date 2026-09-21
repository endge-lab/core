import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RMock } from '@/features/core/modules/domain/entities/RMock'
import { EndgeMock_Module } from '@/features/core/modules/mock/EndgeMock_Module'

describe('проверка Mock в Endge', () => {
  afterEach(() => {
    Endge.domain.reset()
    Endge.mock.reset()
  })

  it('читает JSON из сохранённого RMock и возвращает независимую копию', () => {
    const registry = new EndgeMock_Module()
    Endge.domain.addMock(makeMock({
      identity: 'test.rows',
      source: '{"rows":[{"id":1}]}',
    }))

    const first = registry.get<{ rows: Array<{ id: number }> }>('test.rows')
    first.rows[0]!.id = 2

    expect(registry.get('test.rows')).toEqual({ rows: [{ id: 1 }] })
  })

  it('подключает сохранённый RMock к провайдеру кода', () => {
    const registry = new EndgeMock_Module()
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

  it('запускается без скрытых встроенных провайдеров', () => {
    const registry = new EndgeMock_Module()

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
