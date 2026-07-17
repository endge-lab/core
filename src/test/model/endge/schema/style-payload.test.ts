import { describe, expect, it, vi } from 'vitest'

import { RStyle } from '@/domain/entities/reflect/RStyle'
import { stylePayloadDocToPlain } from '@/model/endge/domain/endge-domain'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeSchemaStorage } from '@/model/endge/schema/endge-schema-database'

describe('style Payload persistence', () => {
  it('hydrates an RStyle from the canonical source-first fields', () => {
    const plain = stylePayloadDocToPlain({
      id: 17,
      identity: 'flight-board',
      displayName: 'Flight board',
      description: 'Shared visual rules',
      source: 'opaque EndgeCSS source',
      sourceVersion: 2,
      folder: { id: 21 },
      project: { id: 5 },
      active: true,
      inherited: true,
      meta: { scope: 'workspace' },
    })
    const style = RStyle.fromPlain(plain)

    expect(style).toMatchObject({
      id: 17,
      identity: 'flight-board',
      name: 'Flight board',
      description: 'Shared visual rules',
      source: 'opaque EndgeCSS source',
      sourceVersion: 2,
      folderId: 21,
      active: true,
      inherited: true,
      meta: { scope: 'workspace' },
    })
    expect(style).not.toHaveProperty('project')
    expect(style.toPlain()).not.toHaveProperty('styles')
    expect(style.toPlain()).not.toHaveProperty('project')
  })

  it('creates the styles root and persists source without legacy JSON', async () => {
    const style = RStyle.fromPlain({
      identity: 'flight-board',
      displayName: 'Flight board',
      source: 'opaque EndgeCSS source',
      sourceVersion: 1,
    })
    const upsert = vi.fn(async (payload: Record<string, unknown>) => payload)
    const createFolder = vi.fn(async () => ({ id: 42 }))
    const storage = new EndgeSchemaStorage()

    vi.spyOn(Endge, 'domain', 'get').mockReturnValue({} as any)
    storage.repositories = {
      styles: {
        findByIdentity: vi.fn(async () => null),
        upsert,
      },
      folders: {
        findByIdentity: vi.fn(async () => null),
        create: createFolder,
      },
    } as any
    ;(storage as any)._applyPayloadDocToDomain = vi.fn()

    await storage.saveDocument(style.identity, 'style', { model: style })

    expect(createFolder).toHaveBeenCalledWith({
      identity: 'root-styles',
      displayName: 'Стили',
      entityType: 'styles',
    })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      identity: style.identity,
      displayName: style.displayName,
      folder: 42,
      source: style.source,
      sourceVersion: 1,
    }))
    expect(upsert.mock.calls[0]?.[0]).not.toHaveProperty('styles')
    expect(upsert.mock.calls[0]?.[0]).not.toHaveProperty('project')
  })
})
