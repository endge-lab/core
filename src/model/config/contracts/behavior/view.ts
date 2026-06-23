import type { BehaviorContract } from '@/domain/types/faceted-cascade'

import {
  BehaviorContractKind,
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
} from '@/domain/types/faceted-cascade'

export const VIEW_BEHAVIOR_CONTRACTS: BehaviorContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.View,
    eventName: 'before-render',
    title: 'Before render',
    description: 'Подмена поведения view перед рендерингом. Подходит для подготовки структуры данных и конфигурации отображения.',
    eventKind: BehaviorContractKind.Composition,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.View,
    eventName: 'after-render',
    title: 'After render',
    description: 'Подмена поведения view после завершения рендеринга и сборки интерфейса.',
    eventKind: BehaviorContractKind.Composition,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.View,
    eventName: 'mounted',
    title: 'View mounted',
    description: 'Подмена поведения после монтирования runtime view.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.View,
    eventName: 'ready',
    title: 'View ready',
    description: 'Подмена поведения после полной готовности view к работе.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
