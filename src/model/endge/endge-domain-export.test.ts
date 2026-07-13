import { afterEach, describe, expect, it } from 'vitest'

import { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RDataView } from '@/domain/entities/reflect/RDataView'
import type { REntity } from '@/domain/entities/reflect/REntity'
import { QueryType } from '@/domain/types/document.types'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { RStore } from '@/domain/entities/reflect/RStore'
import { DEFAULT_ENDGE_WORKSPACE } from '@/model/config/endge-workspace'
import { Endge } from '@/model/endge/endge'
import { EndgeDomain } from '@/model/endge/endge-domain'

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
    domain.addComponentSFC(initializeEntity(new RComponentSFC(), 6, 'component-sfc'))
    domain.addAuthProfile(initializeEntity(new RAuthProfile(), 7, 'auth-profile'))

    const plain = domain.toPlain()

    expect(Object.keys(plain).sort()).toEqual([
      'actions',
      'authProfiles',
      'behaviorBindings',
      'componentSFCs',
      'components',
      'compositions',
      'converters',
      'dataViews',
      'environments',
      'filters',
      'folders',
      'i18nBundles',
      'integrations',
      'navigations',
      'pageTemplates',
      'pages',
      'parameters',
      'policies',
      'presentationBindings',
      'projects',
      'queries',
      'stores',
      'styles',
      'tenants',
      'types',
      'views',
      'vocabs',
    ])
    expect(plain.queries).toEqual([
      expect.objectContaining({ identity: 'custom-query' }),
    ])
    expect(plain.dataViews).toEqual([expect.objectContaining({ identity: 'data-view' })])
    expect(plain.compositions).toEqual([expect.objectContaining({ identity: 'composition' })])
    expect(plain.stores).toEqual([expect.objectContaining({ identity: 'store' })])
    expect(plain.componentSFCs).toEqual([expect.objectContaining({ identity: 'component-sfc' })])
    expect(plain.authProfiles).toEqual([expect.objectContaining({ identity: 'auth-profile' })])
  })

  it('builds a workspace-aware bundle that can restore the domain', () => {
    const workspace = {
      ...DEFAULT_ENDGE_WORKSPACE,
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
