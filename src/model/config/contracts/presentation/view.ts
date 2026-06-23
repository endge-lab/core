import type { PresentationContract } from '@/domain/types/faceted-cascade'

import {
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
  PresentationContractKind,
} from '@/domain/types/faceted-cascade'

export const VIEW_PRESENTATION_CONTRACTS: PresentationContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.View,
    role: 'main',
    title: 'View main',
    description: 'Основной слот представления view. Через него подменяется главный renderer вида.',
    contractKind: PresentationContractKind.Renderer,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.View,
    role: 'toolbar',
    title: 'View toolbar',
    description: 'Слот подмены toolbar-зоны view.',
    contractKind: PresentationContractKind.Layout,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.View,
    role: 'loading',
    title: 'View loading',
    description: 'Слот подмены состояния загрузки view.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.View,
    role: 'empty',
    title: 'View empty',
    description: 'Слот подмены empty-состояния view.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.View,
    role: 'error',
    title: 'View error',
    description: 'Слот подмены error-состояния view.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
