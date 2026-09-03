import { describe, expect, it } from 'vitest'

import {
  createNewDomainDocument,
  DOMAIN_DOCUMENT_DESCRIPTORS,
  getDomainDocumentDescriptor,
} from '@/modules/domain/documents/domain-document-descriptors'
import { RAction } from '@/modules/domain/entities/RAction'
import { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'
import { RComposition } from '@/modules/domain/entities/RComposition'
import { RComputation } from '@/modules/domain/entities/RComputation'
import { RMock } from '@/modules/domain/entities/RMock'
import { RQuery } from '@/modules/domain/entities/RQuery'
import { ENDGE_STYLE_DEFAULT_SOURCE, RStyle } from '@/modules/domain/entities/RStyle'
import { RType } from '@/modules/domain/entities/RType'
import { ComponentType, DOMAIN_DOCUMENT_TYPES, QueryType } from '@/modules/domain/types/document/document.types'

describe('domainDocumentDescriptors', () => {
  it('creates a source-first query draft without a persisted id', () => {
    const draft = createNewDomainDocument(QueryType.REST, {
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
    const draft = createNewDomainDocument(ComponentType.SFC, {
      identity: 'status-label',
    })

    expect(draft).toBeInstanceOf(RComponentSFC)
    expect(draft.name).toBe('status-label')
    expect((draft as RComponentSFC).source).toContain('<Text>')
  })

  it('creates a canonical Source Action', () => {
    const draft = createNewDomainDocument('action', {
      identity: 'refresh-data',
      name: 'Refresh data',
    })

    expect(draft).toBeInstanceOf(RAction)
    expect((draft as RAction).source).toContain('defineAction')
    expect((draft as RAction).sourceVersion).toBe(1)
  })

  it('creates a persisted JSON mock draft', () => {
    const draft = createNewDomainDocument('mock', {
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
    const draft = createNewDomainDocument('computation', {
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

  it('creates a library Composition by default', () => {
    const draft = createNewDomainDocument('composition', {
      identity: 'project-startup',
      name: 'Project startup',
      folderId: 'root-compositions',
    })

    expect(draft).toBeInstanceOf(RComposition)
    expect(draft).toMatchObject({
      identity: 'project-startup',
      kind: 'library',
      kindIdentity: null,
      folderId: 'root-compositions',
    })
  })

  it('creates a source-first style draft without derived artifacts', () => {
    const draft = createNewDomainDocument('style', {
      identity: 'flight-board',
      name: 'Flight board',
      folderId: 'root-styles',
    })

    expect(draft).toBeInstanceOf(RStyle)
    expect(draft).toMatchObject({
      identity: 'flight-board',
      displayName: 'Flight board',
      source: ENDGE_STYLE_DEFAULT_SOURCE,
      sourceVersion: 1,
      folderId: 'root-styles',
    })
    expect((draft as RStyle).toPlain()).not.toHaveProperty('styles')
  })

  it('creates a source-first complex type draft', () => {
    const draft = createNewDomainDocument('type', {
      identity: 'flight-status',
      name: 'Flight status',
      folderId: 'root-types',
    })

    expect(draft).toBeInstanceOf(RType)
    expect(draft).toMatchObject({
      identity: 'flight-status',
      name: 'Flight status',
      displayName: 'Flight status',
      isPrimitive: false,
      sourceVersion: 1,
      folderId: 'root-types',
    })
    expect((draft as RType).source).toContain('defineType')
  })

  it('rejects an empty identity', () => {
    expect(() => createNewDomainDocument(QueryType.REST, { identity: '  ' }))
      .toThrow('Document identity is required.')
  })

  /** Гарантирует descriptor и явные capabilities для каждого canonical document type. */
  it('covers every canonical document type with explicit capability values', () => {
    expect(Object.keys(DOMAIN_DOCUMENT_DESCRIPTORS).sort())
      .toEqual([...DOMAIN_DOCUMENT_TYPES].sort())

    for (const type of DOMAIN_DOCUMENT_TYPES) {
      const descriptor = getDomainDocumentDescriptor(type)
      expect(descriptor.type).toBe(type)
      expect(descriptor.structuralValidationOwner).toBe('entity')
      expect(descriptor.capabilities).toHaveProperty('source')
      expect(descriptor.capabilities).toHaveProperty('program')
      expect(descriptor.capabilities).toHaveProperty('runtime')
    }
  })

  /** Проверяет единый round-trip создания, сериализации и материализации Query. */
  it('round-trips a persisted query through its descriptor', () => {
    const descriptor = getDomainDocumentDescriptor(QueryType.REST)
    const draft = createNewDomainDocument(QueryType.REST, {
      identity: 'flight-list',
      name: 'Flights',
      folderId: 'queries-root',
    })
    const serialized = descriptor.persistence?.serialize(draft, {
      resolveFolderIdentity: value => String(value),
      resolveNavigationIdentity: value => String(value),
      resolveEnvironmentIdentity: value => String(value),
    })
    const materialized = descriptor.materialize(serialized ?? {})

    expect(descriptor.persistence?.collection).toBe('queries')
    expect(materialized).toBeInstanceOf(RQuery)
    expect(materialized).toMatchObject({
      identity: 'flight-list',
      displayName: 'Flights',
      sourceVersion: 2,
    })
  })

  /** Фиксирует отсутствие несуществующих Source, Program и Runtime возможностей. */
  it('represents unsupported capabilities as null', () => {
    expect(getDomainDocumentDescriptor('auth-profile').capabilities).toEqual({
      source: null,
      program: null,
      runtime: null,
    })
    expect(getDomainDocumentDescriptor('page').capabilities).toEqual({
      source: null,
      program: null,
      runtime: 'page',
    })
  })
})
