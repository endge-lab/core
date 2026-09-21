import type { DocumentCreateResult } from '@/features/core/modules/domain/types/document/document-create.type'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Endge } from '@/features/core/kernel/endge'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function prepare(source = 'type First { id: ID! } type Second { name: String }') {
  const plan = Endge.documentImport.prepare({ format: 'graphql', source })
  return { planId: plan.id, selectedCandidateIds: plan.candidates.map(item => item.id), destination: { folderId: null } }
}

describe('жизненный цикл применения импорта', () => {
  beforeEach(() => {
    vi.spyOn(Endge.domainRepository, 'capabilities', 'get').mockReturnValue({ provider: 'service-backend', mutations: true, softDelete: true, restore: true })
  })
  afterEach(() => {
    vi.restoreAllMocks()
    Endge.documentImport.reset()
    Endge.domainRepository.reset()
    Endge.domain.reset()
  })

  /** Поздняя запись старого plan не должна продолжать импорт или очищать новый plan. */
  it.each(['reset', 'provider'] as const)('прекращает apply после смены %s и сохраняет новый plan', async (change) => {
    const first = deferred<DocumentCreateResult>()
    const create = vi.spyOn(Endge.domainRepository, 'createDocument').mockImplementation(async request => ({ documentType: request.documentType, identity: request.identity }))
    create.mockImplementationOnce(() => first.promise)
    const old = Endge.documentImport.apply(prepare())
    const cancelled = expect(old).rejects.toMatchObject({ name: 'AbortError' })
    if (change === 'reset') {
      Endge.documentImport.reset()
    }
    else { Endge.domainRepository.reset() }
    const next = change === 'reset' ? prepare('type Third { id: ID! }') : null
    first.resolve({ documentType: 'type', identity: 'First' })
    await cancelled
    expect(create.mock.calls.map(([request]) => request.identity)).toEqual(['First'])
    if (next) {
      await expect(Endge.documentImport.apply(next)).resolves.toMatchObject({ imported: 1 })
      expect(create.mock.calls.map(([request]) => request.identity)).toEqual(['First', 'Third'])
    }
  })

  it('не разрешает prepare или второй apply во время активной записи', async () => {
    const first = deferred<DocumentCreateResult>()
    vi.spyOn(Endge.domainRepository, 'createDocument').mockImplementation(() => first.promise)
    const request = prepare('type First { id: ID! }')
    const pending = Endge.documentImport.apply(request)
    expect(() => prepare()).toThrow('already running')
    await expect(Endge.documentImport.apply(request)).rejects.toThrow('already running')
    first.resolve({ documentType: 'type', identity: 'First' })
    await expect(pending).resolves.toMatchObject({ imported: 1 })
  })

  it('продолжает тот же импорт после обычной ошибки одного документа', async () => {
    vi.spyOn(Endge.domainRepository, 'createDocument')
      .mockRejectedValueOnce(new Error('backend rejected First'))
      .mockResolvedValueOnce({ documentType: 'type', identity: 'Second' })
    await expect(Endge.documentImport.apply(prepare())).resolves.toMatchObject({ imported: 1, failed: 1 })
  })
})
