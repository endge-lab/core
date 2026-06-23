import type { PresentationContract } from '@/domain/types/faceted-cascade'

import {
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
  PresentationContractKind,
} from '@/domain/types/faceted-cascade'

export const PROJECT_PRESENTATION_CONTRACTS: PresentationContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Project,
    role: 'shell',
    title: 'Project shell',
    description: 'Слот подмены основного каркаса проекта: обвязка приложения, навигация, панели и общая структура.',
    contractKind: PresentationContractKind.Layout,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Project,
    role: 'logo',
    title: 'Project logo',
    description: 'Слот подмены логотипа проекта. Это типичный tenant-specific presentation override.',
    contractKind: PresentationContractKind.Asset,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Project,
    role: 'navigation',
    title: 'Project navigation',
    description: 'Слот подмены навигационного представления проекта: меню, sidebar или header navigation.',
    contractKind: PresentationContractKind.Layout,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Project,
    role: 'loading',
    title: 'Project loading',
    description: 'Слот подмены экрана загрузки проекта.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.Project,
    role: 'error',
    title: 'Project error',
    description: 'Слот подмены error-состояния проекта.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
