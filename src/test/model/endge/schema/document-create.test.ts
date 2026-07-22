import { afterEach, describe, expect, it, vi } from 'vitest'

import { RQuery } from '@/domain/entities/reflect/RQuery'
import { ComponentType, QueryType } from '@/domain/types/document/document.types'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeSchemaStorage } from '@/model/endge/schema/endge-schema-database'
import { DocumentDraftFactory } from '@/model/services/document/DocumentDraftFactory'

describe('document create flow', () => {
  afterEach(() => vi.restoreAllMocks())

  it('rejects an identity that already exists without calling save', async () => {
    const storage = new EndgeSchemaStorage()
    storage.repositories = {
      queries: {
        findByIdentity: vi.fn(async () => ({ id: 7, identity: 'flights' })),
      },
    } as any
    const saveDocument = vi.spyOn(storage, 'saveDocument')

    await expect(storage.createDocument({
      documentType: QueryType.REST,
      identity: 'flights',
      mode: 'model',
      model: {},
    })).rejects.toThrow('Документ "flights" уже существует')

    expect(saveDocument).not.toHaveBeenCalled()
  })

  it('uses the model save path after the create-only check', async () => {
    const storage = new EndgeSchemaStorage()
    const model = { identity: 'new-query' }
    storage.repositories = {
      queries: {
        findByIdentity: vi.fn(async () => null),
      },
    } as any
    const saveDocument = vi.spyOn(storage, 'saveDocument').mockResolvedValue()

    await expect(storage.createDocument({
      documentType: QueryType.REST,
      identity: ' new-query ',
      mode: 'model',
      model,
    })).resolves.toEqual({
      documentType: QueryType.REST,
      identity: 'new-query',
    })

    expect(saveDocument).toHaveBeenCalledWith('new-query', QueryType.REST, { model })
  })

  it('persists the selected query folder', async () => {
    const query = new RQuery()
    query.identity = 'flight-list'
    query.name = 'Flight list'
    query.displayName = 'Flight list'
    query.type = QueryType.REST
    query.folderId = 77
    query.source = 'defineQuery({})'
    query.sourceVersion = 2

    const create = vi.fn(async (payload: Record<string, unknown>) => ({ id: 8, ...payload }))
    const storage = new EndgeSchemaStorage()
    vi.spyOn(Endge, 'domain', 'get').mockReturnValue({ getFolder: vi.fn(() => null) } as any)
    storage.repositories = {
      queries: {
        findByIdentity: vi.fn(async () => null),
        create,
      },
    } as any
    ;(storage as any)._applyPayloadDocToDomain = vi.fn()

    await storage.saveDocument(query.identity, QueryType.REST, { model: query })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      identity: 'flight-list',
      folder: 77,
    }))
  })

  it('persists the selected legacy component folder', async () => {
    const component = DocumentDraftFactory.create(ComponentType.DSL, {
      identity: 'flight-card',
      name: 'Flight card',
      folderId: 88,
    })
    const create = vi.fn(async (payload: Record<string, unknown>) => ({ id: 9, ...payload }))
    const storage = new EndgeSchemaStorage()
    vi.spyOn(Endge, 'domain', 'get').mockReturnValue({} as any)
    storage.repositories = {
      components: {
        findAll: vi.fn(async () => []),
        findByIdentity: vi.fn(async () => null),
        create,
      },
      converters: {
        findAll: vi.fn(async () => []),
      },
    } as any
    ;(storage as any)._applyPayloadDocToDomain = vi.fn()

    await storage.saveDocument(component.identity, ComponentType.DSL, { model: component })

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      identity: 'flight-card',
      folder: 88,
    }))
  })
})
