import { afterEach, describe, expect, it } from 'vitest'

import { RStore } from '@/domain/entities/reflect/RStore'
import { RMock } from '@/domain/entities/reflect/RMock'
import { Endge } from '@/model/endge/kernel/endge'

describe('EndgeCompiler Store mock dependencies', () => {
  afterEach(() => {
    Endge.program.clear()
    Endge.domain.reset()
    Endge.mock.reset()
  })

  it('publishes persisted mock as an explicit artifact dependency', () => {
    Endge.domain.addMock(makeMock('groundhandling'))
    const store = makeStore('groundhandling')

    const artifact = Endge.compiler.buildStore(store)

    expect(artifact.status).toBe('valid')
    expect(artifact.dependencies).toContainEqual({
      entityType: 'mock-data',
      id: 'groundhandling',
      identity: 'groundhandling',
      role: 'store-initial:raw',
    })
  })

  it('reports an unregistered mock before runtime launch', () => {
    const store = makeStore('missing.mock')

    const artifact = Endge.compiler.buildStore(store)

    expect(artifact.status).toBe('error')
    expect(artifact.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'store-mock-document-missing',
        sourcePath: 'data.raw',
      }),
    ]))
  })
})

function makeStore(mockIdentity: string): RStore {
  const store = new RStore()
  store.id = mockIdentity === 'groundhandling' ? 201 : 202
  store.identity = `store-${mockIdentity}`
  store.name = store.identity
  store.source = `defineStore({ data: { raw: value(mock('${mockIdentity}')) } })`
  return store
}

function makeMock(identity: string, contentSource: 'document' | 'code-provider' = 'document', codeRef: string | null = null): RMock {
  const mock = new RMock()
  mock.id = 301
  mock.identity = identity
  mock.name = identity
  mock.displayName = identity
  mock.contentSource = contentSource
  mock.codeRef = codeRef
  return mock
}
