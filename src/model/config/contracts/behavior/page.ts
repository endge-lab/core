import type { BehaviorContract } from '@/domain/types/faceted-cascade'

import {
  BehaviorContractKind,
  EndgeFacetType,
  FacetedCascadeEntityType,
  FacetedCascadeScope,
} from '@/domain/types/faceted-cascade'

/**
 * Контракты подмены поведения для Page.
 *
 * Здесь важно различать два разных цикла жизни страницы:
 *
 * 1. Runtime lifecycle
 * Page как runtime-сущность может быть создана один раз и жить дольше,
 * чем конкретный визуальный показ страницы. Пока runtime жив, он может
 * удерживать контекст, кэш и результаты прошлых операций. Это означает,
 * что пользователь может повторно открыть страницу, а runtime при этом
 * останется тем же самым и продолжит работать с уже прогретым состоянием.
 *
 * 2. Presentation mount lifecycle
 * Поверх уже существующего runtime страница может много раз монтироваться
 * и размонтироваться в UI-слое. Именно это соответствует пользовательскому
 * опыту "открыть страницу", "закрыть страницу", "зайти снова".
 *
 * Поэтому page behavior contracts читаются так:
 *
 * - `ready` описывает готовность page runtime как живой runtime-сущности;
 * - `before-enter`, `enter`, `mounted`, `before-leave`, `leave` описывают
 *   цикл подключения и отключения визуального слоя над этим runtime;
 * - `params-change` относится к изменению входного контекста страницы;
 *
 * Иными словами:
 * runtime страницы может жить долго,
 * а mount/unmount страницы может происходить много раз поверх одного runtime.
 */
export const PAGE_BEHAVIOR_CONTRACTS: BehaviorContract<FacetedCascadeEntityType>[] = [
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Page,
    eventName: 'before-enter',
    title: 'Before page mount',
    description: 'Подмена поведения перед подключением страницы к UI-слою. Runtime страницы уже может существовать, но визуальный mount ещё не начался.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Page,
    eventName: 'enter',
    title: 'Page mount start',
    description: 'Подмена поведения в момент начала mount-цикла страницы. Это уже вход в активный показ, но ещё не финальный mounted.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Page,
    eventName: 'mounted',
    title: 'Page mounted (presentation attached)',
    description: 'Подмена поведения после фактического монтирования страницы в presentation/UI-слое. Это не рождение runtime, а подключение визуального представления.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Page,
    eventName: 'ready',
    title: 'Page runtime ready',
    description: 'Подмена поведения после полной готовности page runtime как живой runtime-сущности. Этот runtime может переживать несколько mount/unmount циклов и повторно использовать кэш.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Page,
    eventName: 'params-change',
    title: 'Page params changed',
    description: 'Подмена поведения при изменении входных параметров страницы. Полезно для перерасчёта состояния и обновления query внутри уже существующего runtime.',
    eventKind: BehaviorContractKind.Interaction,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Page,
    eventName: 'before-leave',
    title: 'Before page unmount',
    description: 'Подмена поведения перед отключением страницы от UI-слоя. Подходит для проверок несохранённых изменений и мягкого завершения visual session.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
  {
    facet: EndgeFacetType.Behavior,
    entityType: FacetedCascadeEntityType.Page,
    eventName: 'leave',
    title: 'Page unmounted (presentation detached)',
    description: 'Подмена поведения после отключения страницы от UI-слоя. Сам page runtime при этом может остаться живым и быть использован при следующем открытии страницы.',
    eventKind: BehaviorContractKind.Lifecycle,
    scope: FacetedCascadeScope.Owner,
    supportsEnvironmentOverride: true,
  },
]
