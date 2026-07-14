import { describe, expect, it } from 'vitest'

import { RAction } from '@/domain/entities/reflect/RAction'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { ComponentType, QueryType } from '@/domain/types/document/document.types'
import { DocumentDraftFactory } from '@/model/services/document/DocumentDraftFactory'

describe('DocumentDraftFactory', () => {
  it('creates a source-first query draft without a persisted id', () => {
    const draft = DocumentDraftFactory.create(QueryType.REST, {
      identity: 'flight-list',
      name: 'Flights',
      folderId: 'root-queries',
    })

    expect(draft).toBeInstanceOf(RQuery)
    expect(draft).toMatchObject({
      identity: 'flight-list',
      name: 'Flights',
      displayName: 'Flights',
      type: QueryType.REST,
      folderId: 'root-queries',
      sourceVersion: 2,
    })
    expect((draft as RQuery).source).toContain('defineQuery')
    expect(draft.id).toBeUndefined()
  })

  it('uses the canonical SFC source template', () => {
    const draft = DocumentDraftFactory.create(ComponentType.SFC, {
      identity: 'status-label',
    })

    expect(draft).toBeInstanceOf(RComponentSFC)
    expect(draft.name).toBe('status-label')
    expect((draft as RComponentSFC).source).toContain('<Text>')
  })

  it('creates an empty action flow', () => {
    const draft = DocumentDraftFactory.create('action', {
      identity: 'refresh-data',
      name: 'Refresh data',
    })

    expect(draft).toBeInstanceOf(RAction)
    expect((draft as RAction).definition).toEqual({
      version: 1,
      entrypoint: 'flow-entry',
      nodes: [],
      edges: [],
    })
  })

  it('rejects an empty identity', () => {
    expect(() => DocumentDraftFactory.create(QueryType.REST, { identity: '  ' }))
      .toThrow('Document identity is required.')
  })
})
