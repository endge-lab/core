import type { PresentationContract } from '@/domain/types/configuration/faceted-cascade'

import {
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
  PresentationContractKind,
} from '@/domain/types/configuration/faceted-cascade'

export const PAGE_TEMPLATE_PRESENTATION_CONTRACTS: PresentationContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.PageTemplate,
    role: 'layout',
    title: 'Template layout',
    description: 'Слот подмены базовой layout-композиции шаблона страницы.',
    contractKind: PresentationContractKind.Layout,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.PageTemplate,
    role: 'header',
    title: 'Template header',
    description: 'Слот подмены header-области шаблона страницы.',
    contractKind: PresentationContractKind.Layout,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.PageTemplate,
    role: 'sidebar',
    title: 'Template sidebar',
    description: 'Слот подмены sidebar-области шаблона страницы.',
    contractKind: PresentationContractKind.Layout,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.PageTemplate,
    role: 'footer',
    title: 'Template footer',
    description: 'Слот подмены footer-области шаблона страницы.',
    contractKind: PresentationContractKind.Layout,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Presentation,
    entityType: FacetedCascadeEntityType.PageTemplate,
    role: 'empty',
    title: 'Template empty',
    description: 'Слот подмены empty-состояния template-слоя.',
    contractKind: PresentationContractKind.State,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
