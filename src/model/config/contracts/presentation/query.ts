import type { PresentationContract } from '@/domain/types/faceted-cascade'

import {
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
  PresentationContractKind,
} from '@/domain/types/faceted-cascade'

export const QUERY_PRESENTATION_CONTRACTS: PresentationContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Query,
    role: 'result',
    title: 'Query result',
    description: 'Слот подмены визуального представления успешного результата query.',
    contractKind: PresentationContractKind.Renderer,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Query,
    role: 'loading',
    title: 'Query loading',
    description: 'Слот подмены loading-представления query.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Query,
    role: 'empty',
    title: 'Query empty',
    description: 'Слот подмены empty-представления query, когда данные отсутствуют.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Query,
    role: 'error',
    title: 'Query error',
    description: 'Слот подмены error-представления query.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
