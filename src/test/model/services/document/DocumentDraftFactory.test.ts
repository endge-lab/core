import { describe, expect, it } from 'vitest'

import { RAction } from '@/domain/entities/reflect/RAction'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RMock } from '@/domain/entities/reflect/RMock'
import { RComputation } from '@/domain/entities/reflect/RComputation'
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

  it('creates a persisted JSON mock draft', () => {
    const draft = DocumentDraftFactory.create('mock', {
      identity: 'orders-response',
      name: 'Orders response',
      folderId: 'root-mocks',
    })

    expect(draft).toBeInstanceOf(RMock)
    expect(draft).toMatchObject({
      identity: 'orders-response',
      displayName: 'Orders response',
      contentSource: 'document',
      contentType: 'application/json',
      source: '{}',
      folderId: 'root-mocks',
    })
  })

  it('creates a source-first computation draft', () => {
    const draft = DocumentDraftFactory.create('computation', {
      identity: 'ground-handling-cell-state',
      name: 'Ground handling cell state',
      folderId: 'root-computations',
    })

    expect(draft).toBeInstanceOf(RComputation)
    expect(draft).toMatchObject({
      identity: 'ground-handling-cell-state',
      displayName: 'Ground handling cell state',
      sourceVersion: 1,
      contractVersion: 1,
      folderId: 'root-computations',
    })
    expect((draft as RComputation).source).toContain('defineComputation')
  })

  it('rejects an empty identity', () => {
    expect(() => DocumentDraftFactory.create(QueryType.REST, { identity: '  ' }))
      .toThrow('Document identity is required.')
  })
})
