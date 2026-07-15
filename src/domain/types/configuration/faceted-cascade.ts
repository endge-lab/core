import type { EndgeBindingMode, EndgeResolvedOverrideBase } from '@/domain/types/configuration/resolve.types'
import type { ConfigurationContract } from '@/domain/types/configuration/configuration-contract.types'

/**
 * Тип facet-слоя, в котором работает override-специфика.
 * Behavior отвечает за подмену поведения, Presentation - за подмену представления,
 * Configuration - за подмену и наблюдение конфигурационных полей.
 */
export enum EndgeFacetType {
  Behavior = 'behavior',
  Presentation = 'presentation',
  Configuration = 'configuration',
}

/**
 * Базовый набор сущностей, поддерживающих faceted cascade.
 * Это общие entity type для behavior- и presentation-контрактов.
 */
export enum FacetedCascadeEntityType {
  Project = 'project',
  Component = 'component',
  Query = 'query',
  Page = 'page',
  PageTemplate = 'page-template',
}

/**
 * Область действия override-контракта.
 * Owner - слот относится к самой сущности.
 * Target - слот относится к дочерней/связанной сущности.
 * Global - слот описывает глобальную точку расширения.
 */
export enum FacetedCascadeScope {
  Owner = 'owner',
  Target = 'target',
  Global = 'global',
}

/**
 * Упрощённая схема полезной нагрузки или контекста для контракта.
 */
export type FacetedCascadeSchema = Record<string, unknown>

/**
 * Общая база для всех override-контрактов.
 * Контракт описывает допустимый слот подмены, но сам по себе не хранит правило override.
 */
export interface FacetedCascadeContractBase<TEntity extends string = string> {
  /**
   * Facet-слой, к которому относится слот подмены.
   */
  facet: EndgeFacetType

  /**
   * Тип сущности, для которой открыт слот подмены.
   */
  entityType: TEntity

  /**
   * Короткое имя слота для UI и документации.
   */
  title: string

  /**
   * Человекочитаемое описание назначения слота.
   */
  description?: string | null

  /**
   * Область действия слота в каскаде.
   */
  scope: FacetedCascadeScope

  /**
   * Разрешено ли пользователю создавать override/binding для этого слота.
   * Для совместимости со старой behavior-моделью поле оставлено общим и опциональным.
   */
  supportsBinding?: boolean

  /**
   * Можно ли переопределять слот по environment.
   */
  supportsEnvironmentOverride: boolean
}

/**
 * Семантическая категория behavior-слота.
 * Нужна для группировки событий и навигации в конфигураторе.
 */
export enum BehaviorContractKind {
  Lifecycle = 'lifecycle',
  Interaction = 'interaction',
  Data = 'data',
  Composition = 'composition',
}

/**
 * Контракт behavior-слота.
 * Описывает событие, на которое сущность или контекст могут подменять поведение.
 */
export interface BehaviorContract<TEntity extends string = string>
  extends FacetedCascadeContractBase<TEntity> {
  facet: EndgeFacetType.Behavior

  /**
   * Каноническое имя события, используемое как selector в behavior cascade.
   */
  eventName: string

  /**
   * Категория события.
   */
  eventKind: BehaviorContractKind

  /**
   * Схема payload события, если она нужна для UI и валидации.
   */
  payloadSchema?: FacetedCascadeSchema | null

  /**
   * Схема дополнительного runtime-контекста события.
   */
  contextSchema?: FacetedCascadeSchema | null
}

/**
 * Семантическая категория presentation-слота.
 * Нужна для группировки ролей представления в конфигураторе.
 */
export enum PresentationContractKind {
  Renderer = 'renderer',
  Layout = 'layout',
  Asset = 'asset',
  State = 'state',
  Composition = 'composition',
}

/**
 * Контракт presentation-слота.
 * Описывает роль представления, для которой можно подменять renderer, layout, asset или state-specific UI.
 */
export interface PresentationContract<TEntity extends string = string>
  extends FacetedCascadeContractBase<TEntity> {
  facet: EndgeFacetType.Presentation

  /**
   * Каноническая роль представления, используемая как selector в presentation cascade.
   */
  role: string

  /**
   * Категория presentation-слота.
   */
  contractKind: PresentationContractKind

  /**
   * Схема props/контекста, которыми может оперировать presentation-слот.
   */
  propsSchema?: FacetedCascadeSchema | null

  /**
   * Схема дополнительного контекста разрешения presentation-слота.
   */
  contextSchema?: FacetedCascadeSchema | null
}

/**
 * Общий union контрактов faceted cascade.
 * Реестр контрактов хранит все три типа одновременно и различает их по `facet`.
 */
export type EndgeContract<TEntity extends string = string>
  = BehaviorContract<TEntity> | PresentationContract<TEntity> | ConfigurationContract<TEntity>

/**
 * Совместимые aliases для существующего behavior/event-слоя.
 * Пока behavior bindings ещё опираются на термин "event contract".
 */
export type EventContract = BehaviorContract<FacetedCascadeEntityType>
export type EventContractSchema = FacetedCascadeSchema
export {
  FacetedCascadeEntityType as EventContractEntityType,
  BehaviorContractKind as EventContractKind,
  FacetedCascadeScope as EventContractScope,
}

/**
 * Общая база документа override-binding для обоих facet-слоёв.
 * Binding хранит уже конкретное правило подмены в рамках каскада.
 */
export interface FacetedCascadeBindingDocBase {
  id: number
  identity: string
  displayName: string
  projectId?: number | null
  ownerType: string
  ownerId: number
  targetType: string
  targetId?: number | null
  mode: EndgeBindingMode
  priority: number
  isEnabled: boolean
  environmentId?: number | null
  isInherited?: boolean
  originBindingId?: number | null
  folder?: number | null
}

/**
 * База payload для создания/обновления override-binding.
 */
export interface FacetedCascadeBindingWriteDataBase {
  identity: string
  displayName: string
  projectId?: number | null
  ownerType: string
  ownerId: number
  targetType: string
  targetId?: number | null
  mode: EndgeBindingMode
  priority: number
  isEnabled: boolean
  environmentId?: number | null
  isInherited?: boolean
  originBindingId?: number | null
  folder?: number | null
}

/**
 * Общие параметры резолва override-binding.
 */
export interface FacetedCascadeBindingResolverOptions {
  ownerType: string
  ownerId: number
  targetType?: string | null
  targetId?: number | null
  environmentId?: number | null
}

/**
 * База resolved-override результата после применения каскада.
 */
export type FacetedCascadeResolvedBindingBase = EndgeResolvedOverrideBase

/**
 * Конкретное правило подмены поведения.
 */
export interface BehaviorBindingDoc extends FacetedCascadeBindingDocBase {
  targetId: number
  eventName: string
  scriptRef: string
}

/**
 * Payload для записи behavior-binding.
 */
export interface BehaviorBindingWriteData extends FacetedCascadeBindingWriteDataBase {
  targetId: number
  eventName: string
  scriptRef: string
}

/**
 * Параметры резолва behavior-binding для конкретного события.
 */
export interface BehaviorBindingResolverOptions extends FacetedCascadeBindingResolverOptions {
  eventName?: string | null
}

/**
 * Итоговый resolved behavior-binding после применения каскада.
 */
export interface ResolvedBehaviorBinding extends FacetedCascadeResolvedBindingBase {
  eventName: string
  scriptRef: string
}

/**
 * Конкретное правило подмены представления.
 */
export interface PresentationBindingDoc extends FacetedCascadeBindingDocBase {
  role: string
  rendererRef: string
  when?: string | null
}

/**
 * Payload для записи presentation-binding.
 */
export interface PresentationBindingWriteData extends FacetedCascadeBindingWriteDataBase {
  role: string
  rendererRef: string
  when?: string | null
}

/**
 * Параметры резолва presentation-binding для конкретной роли.
 */
export interface PresentationBindingResolverOptions extends FacetedCascadeBindingResolverOptions {
  role?: string | null
}

/**
 * Итоговый resolved presentation-binding после применения каскада.
 */
export interface ResolvedPresentationBinding extends FacetedCascadeResolvedBindingBase {
  role: string
  rendererRef: string
  when: string | null
}

/**
 * Результат резолва behavior-контракта: найденные биндинги и метаданные запроса.
 */
export interface BehaviorResolveResult {
  /** Параметры, с которыми выполнялся резолв. */
  request: BehaviorBindingResolverOptions
  /** Событие (selector), по которому искали. */
  eventName: string
  /** Найденные биндинги после каскада. */
  bindings: ResolvedBehaviorBinding[]
  /** Найден ли хотя бы один биндинг. */
  found: boolean
  /** Количество найденных биндингов. */
  count: number
  /** Фасет для единообразия с presentation. */
  facet: 'behavior'
}

/**
 * Результат резолва presentation-контракта: найденные биндинги и метаданные запроса.
 */
export interface PresentationResolveResult {
  /** Параметры, с которыми выполнялся резолв. */
  request: PresentationBindingResolverOptions
  /** Роль (selector), по которой искали. */
  role: string
  /** Найденные биндинги после каскада. */
  bindings: ResolvedPresentationBinding[]
  /** Найден ли хотя бы один биндинг. */
  found: boolean
  /** Количество найденных биндингов. */
  count: number
  /** Фасет для единообразия с behavior. */
  facet: 'presentation'
}
