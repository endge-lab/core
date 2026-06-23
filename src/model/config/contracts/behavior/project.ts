import type { BehaviorContract } from '@/domain/types/faceted-cascade'

import {
  BehaviorContractKind,
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
} from '@/domain/types/faceted-cascade'

export const PROJECT_BEHAVIOR_CONTRACTS: BehaviorContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Project,
    eventName: 'before-init',
    title: 'Before init',
    description: 'Подмена поведения проекта перед началом инициализации. Подходит для подготовки контекста, переменных и предварительных проверок.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Project,
    eventName: 'init',
    title: 'Project init',
    description: 'Подмена поведения проекта в основной точке инициализации. Это центральный слот запуска проектной runtime-логики.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Project,
    eventName: 'ready',
    title: 'Project ready',
    description: 'Подмена поведения после завершения инициализации проекта. Удобно для безопасного запуска зависимых сценариев.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Project,
    eventName: 'before-dispose',
    title: 'Before dispose',
    description: 'Подмена поведения перед остановкой проекта. Полезно для финализации и сохранения промежуточного состояния.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Project,
    eventName: 'disposed',
    title: 'Disposed',
    description: 'Подмена поведения после завершения жизненного цикла проекта и освобождения его runtime-ресурсов.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
