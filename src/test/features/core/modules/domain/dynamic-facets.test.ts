import { describe, expect, it } from 'vitest'

import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'
import { RFacet } from '@/features/core/modules/domain/entities/RFacet'
import { RFacetDocument } from '@/features/core/modules/domain/entities/RFacetDocument'

describe('динамические фасеты Domain', () => {
  it('нормализует отсутствующие коллекции legacy snapshot в пустые массивы', () => {
    const domain = new EndgeDomain_Module()

    domain.mergeFromSnapshot({
      kind: 'workspace-snapshot',
      schemaVersion: 5,
      workspace: { identity: 'legacy', state: { id: 'workspace-id', revision: 1, generation: 'generation-id', headSequence: 0 } },
      installedIntegrations: [],
      documents: {
        'projects': [],
        'tenants': [],
        'environments': [],
        'folders': [],
        'types': [],
        'queries': [],
        'data-views': [],
        'compositions': [],
        'stores': [],
        'streams': [],
        'simulations': [],
        'updates': [],
        'mocks': [],
        'components': [],
        'actions': [],
        'filters': [],
        'converters': [],
        'computations': [],
        'vocabs': [],
        'i18n-bundles': [],
        'auth-profiles': [],
        'navigations': [],
        'styles': [],
        'configurations': [],
      },
    } as never)

    expect(domain.getFacets()).toEqual([])
    expect(domain.getFacetDocuments('region')).toEqual([])
  })

  it('индексирует одинаковые identity документов независимо внутри каждого фасета', () => {
    const domain = new EndgeDomain_Module()
    domain.addFacetDocument(RFacetDocument.fromPlain({
      id: 'region/default',
      facetIdentity: 'region',
      identity: 'default',
      displayName: 'Region default',
    }))
    domain.addFacetDocument(RFacetDocument.fromPlain({
      id: 'brand/default',
      facetIdentity: 'brand',
      identity: 'default',
      displayName: 'Brand default',
    }))

    expect(domain.getFacetDocument('region', 'default')?.displayName).toBe('Region default')
    expect(domain.getFacetDocument('brand', 'default')?.displayName).toBe('Brand default')
  })

  it('не теряет одинаковые document identity при materialization portable bundle', () => {
    const domain = new EndgeDomain_Module()
    domain.mergeFromBundle({
      kind: 'portable',
      schemaVersion: 6,
      workspace: { identity: 'workspace' },
      installedIntegrations: [],
      documents: {
        'facets': [],
        'facet-documents': [
          { facetIdentity: 'region', identity: 'default', displayName: 'Region default' },
          { facetIdentity: 'brand', identity: 'default', displayName: 'Brand default' },
        ],
        'projects': [],
        'tenants': [],
        'environments': [],
        'folders': [],
        'types': [],
        'queries': [],
        'data-views': [],
        'compositions': [],
        'stores': [],
        'streams': [],
        'simulations': [],
        'updates': [],
        'mocks': [],
        'components': [],
        'actions': [],
        'filters': [],
        'converters': [],
        'computations': [],
        'vocabs': [],
        'i18n-bundles': [],
        'auth-profiles': [],
        'navigations': [],
        'styles': [],
        'configurations': [],
      },
    } as never)

    expect(domain.getFacetDocuments('region')).toHaveLength(1)
    expect(domain.getFacetDocuments('brand')).toHaveLength(1)
  })

  it('сохраняет единственный persisted-порядок и не меняет другие domain-коллекции', () => {
    const domain = new EndgeDomain_Module()
    const before = domain.toPlain()
    domain.addFacet(RFacet.fromPlain({ id: 'brand', identity: 'brand', displayName: 'Brand', position: 1 }))
    domain.addFacet(RFacet.fromPlain({ id: 'region', identity: 'region', displayName: 'Region', position: 0 }))

    expect(domain.getFacets().map(facet => facet.identity)).toEqual(['region', 'brand'])
    expect(domain.toPlain().projects).toEqual(before.projects)
    expect(domain.toPlain().tenants).toEqual(before.tenants)
    expect(domain.toPlain().environments).toEqual(before.environments)
  })
})
