import { afterEach, describe, expect, it } from 'vitest'

import { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RDataView } from '@/domain/entities/reflect/RDataView'
import type { REntity } from '@/domain/entities/reflect/REntity'
import { QueryType } from '@/domain/types/document/document.types'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RStore } from '@/domain/entities/reflect/RStore'
import { RMock } from '@/domain/entities/reflect/RMock'
import { RComputation } from '@/domain/entities/reflect/RComputation'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeDomain } from '@/model/endge/domain/endge-domain'

function createQuery(id: number, identity: string, type: QueryType): RQuery {
  const query = new RQuery()
  query.id = id
  query.identity = identity
  query.name = identity
  query.displayName = identity
  query.type = type
  query.source = `query({ identity: '${identity}' })`
  return query
}

function initializeEntity<T extends REntity>(entity: T, id: number, identity: string): T {
  entity.id = id
  entity.identity = identity
  entity.name = identity
  entity.displayName = identity
  return entity
}

describe('Endge domain export', () => {
  afterEach(() => {
    Endge.domain.reset()
    Endge.workspace.reset()
  })

  it('exports every persisted entity family and excludes temporary entities', () => {
    const domain = new EndgeDomain()
    const customQuery = createQuery(1, 'custom-query', QueryType.Custom)
    const temporaryQuery = createQuery(2, 'temporary-query', QueryType.REST)
    temporaryQuery.isTemporary = true

    domain.addQuery(customQuery)
    domain.addQuery(temporaryQuery)
    domain.addDataView(initializeEntity(new RDataView(), 3, 'data-view'))
    domain.addComposition(initializeEntity(new RComposition(), 4, 'composition'))
    domain.addStore(initializeEntity(new RStore(), 5, 'store'))
    domain.addMock(initializeEntity(new RMock(), 8, 'mock'))
    domain.addComputation(initializeEntity(new RComputation(), 9, 'computation'))
    domain.addComponentSFC(initializeEntity(new RComponentSFC(), 6, 'component-sfc'))
    domain.addAuthProfile(initializeEntity(new RAuthProfile(), 7, 'auth-profile'))

    const plain = domain.toPlain()

    expect(Object.keys(plain).sort()).toEqual([
      'actions',
      'authProfiles',
      'componentSFCs',
      'components',
      'compositions',
      'computations',
      'converters',
      'dataViews',
      'environments',
      'filters',
      'folders',
      'i18nBundles',
      'integrations',
      'mocks',
      'navigations',
      'pageTemplates',
      'pages',
      'parameters',
      'policies',
      'projects',
      'queries',
      'stores',
      'styles',
      'tenants',
      'types',
      'vocabs',
    ])
    expect(plain.queries).toEqual([
      expect.objectContaining({ identity: 'custom-query' }),
    ])
    expect(plain.dataViews).toEqual([expect.objectContaining({ identity: 'data-view' })])
    expect(plain.compositions).toEqual([expect.objectContaining({ identity: 'composition' })])
    expect(plain.stores).toEqual([expect.objectContaining({ identity: 'store' })])
    expect(plain.mocks).toEqual([expect.objectContaining({ identity: 'mock' })])
    expect(plain.computations).toEqual([expect.objectContaining({ identity: 'computation' })])
    expect(plain.componentSFCs).toEqual([expect.objectContaining({ identity: 'component-sfc' })])
    expect(plain.authProfiles).toEqual([expect.objectContaining({ identity: 'auth-profile' })])
  })

  it('builds a workspace-aware bundle that can restore the domain', () => {
    const workspace = {
      ...TEST_ENDGE_WORKSPACE,
      identity: 'workspace-export-test',
      displayName: 'Workspace export test',
      vars: [{ name: 'apiBaseUrl', defaultValue: '/api/test' }],
      sse: {
        url: '/api/events',
        authMode: 'manual' as const,
        manualToken: 'must-not-be-exported',
      },
    }
    Endge.workspace.apply(workspace)
    Endge.domain.addQuery(createQuery(1, 'bundle-query', QueryType.Custom))

    const bundle = Endge.exportDomainBundle()
    const restored = EndgeDomain.fromPlain(bundle)

    expect(bundle.version).toBe('1.1.0')
    expect(bundle.workspace).toEqual({
      ...workspace,
      sse: {
        url: '/api/events',
        authMode: 'manual',
      },
    })
    expect(bundle.workspace.sse).not.toHaveProperty('manualToken')
    expect(restored.getQueryByIdentity('bundle-query')).not.toBeNull()
  })
})
