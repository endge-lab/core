import type { BehaviorContract } from '@/domain/types/configuration/faceted-cascade'

import {
  BehaviorContractKind,
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
} from '@/domain/types/configuration/faceted-cascade'

export const PAGE_TEMPLATE_BEHAVIOR_CONTRACTS: BehaviorContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.PageTemplate,
    eventName: 'resolved',
    title: 'Template resolved',
    description: 'Подмена поведения после разрешения и сборки шаблона страницы в итоговую композицию.',
    eventKind: BehaviorContractKind.Composition,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.PageTemplate,
    eventName: 'mounted',
    title: 'Template mounted',
    description: 'Подмена поведения после монтирования runtime шаблона страницы.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.PageTemplate,
    eventName: 'ready',
    title: 'Template ready',
    description: 'Подмена поведения после полной готовности шаблона страницы.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
