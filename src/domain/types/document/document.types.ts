import type { RAction } from '@/domain/entities/reflect/RAction'
import type { RConverter } from '@/domain/entities/reflect/RConverter'
import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { RIntegration } from '@/domain/entities/reflect/RIntegration'
import type { RParameter } from '@/domain/entities/reflect/RParameter'
import type { RView } from '@/domain/entities/reflect/RView'
import type { RPageTemplate } from '@/domain/entities/reflect/RPageTemplate'
import type { RPage } from '@/domain/entities/reflect/RPage'
import type { RNavigation } from '@/domain/entities/reflect/RNavigation'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RDataView } from '@/domain/entities/reflect/RDataView'
import type { RPolicy } from '@/domain/entities/reflect/RPolicy'
import type { RStyle } from '@/domain/entities/reflect/RStyle'
import type { RTenant } from '@/domain/entities/reflect/RTenant'
import type { RBehaviorBinding } from '@/domain/entities/reflect/RBehaviorBinding'
import type { RPresentationBinding } from '@/domain/entities/reflect/RPresentationBinding'
import type { RVocabs } from '@/domain/entities/reflect/RVocabs'
import type { RI18nBundle } from '@/domain/entities/reflect/RI18nBundle'
import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import type { RWorkspace } from '@/domain/entities/reflect/RWorkspace'
import type { RComponent } from '@/domain/types/component/component.types'
import type { RComposition } from '@/domain/entities/reflect/RComposition'
import type { RStore } from '@/domain/entities/reflect/RStore'
import type { RMock } from '@/domain/entities/reflect/RMock'
import type { RComputation } from '@/domain/entities/reflect/RComputation'

/**
 * Разновидности типов компонентов
 */
export enum ComponentType {
  Component = 'component',
  /** Legacy table-column template type; not a standalone document. */
  Html = 'html',
  DSL = 'component-dsl',
  Table = 'component-table',
  SFC = 'component-sfc',
}

/** Тип документа «Параметр» (коллекция parameters). */
export enum ParameterType {
  DefaultParameter = 'default-parameter',
}

/** Тип документа «Фильтр» (коллекция filters). */
export enum FilterType {
  DefaultFilter = 'default-filter',
}

/**
 * Разновидности типов запросов
 */
export enum QueryType {
  Custom = 'query-custom',
  GraphQL = 'query-gql',
  REST = 'query-rest',
}

/**
 * Вариации секций домена.
 */
export enum DomainSectionType {
  Primitive = 'primitive',
  Type = 'type',
  Component = 'component',
  Query = 'query',
  DataView = 'data-view',
  Composition = 'composition',
  Store = 'store',
  Mock = 'mock',
  Action = 'action',
  Converter = 'converter',
  Computation = 'computation',
  Integration = 'integration',
  View = 'view',
  Parameters = 'parameters',
  Filters = 'filters',
  Environment = 'environment',
  Tenant = 'tenant',
  Policy = 'policy',
  Style = 'style',
  PageTemplate = 'page-template',
  Page = 'page',
  Navigation = 'navigation',
  Vocabs = 'vocabs',
  I18nBundles = 'i18n-bundles',
  AuthProfile = 'auth-profile',
  Project = 'project',
}

/**
 * Все возможные типы документов
 */
export type DomainDocumentType
  = | 'primitive'
    | 'type'
    | 'action'
    | 'converter'
    | 'computation'
    | 'data-view'
    | 'composition'
    | 'store'
    | 'mock'
    | 'integration'
    | 'view'
    | 'page-template'
    | 'page'
    | 'navigation'
    | 'environment'
    | 'policy'
    | 'style'
    | 'behavior-binding'
    | 'presentation-binding'
    | 'vocabs'
    | 'i18n-bundles'
    | 'auth-profile'
    | 'tenant'
    | 'project'
    | 'workspace'
    | Exclude<ComponentType, ComponentType.Component | ComponentType.Html>
    | QueryType
    | ParameterType
    | FilterType

/**
 * Описывает любой документ
 */
export interface Document {
  // Тип документа
  type: DomainDocumentType

  // Тип секции
  sectionType: DomainSectionType

  // Идентификатор сущности документа
  id: string
}

/**
 * Описывает любой документ рефлекцию
 */
export type RDocument = RComponent | RComponentSFC | RQuery | RDataView | RComposition | RStore | RMock | RAction | RConverter | RComputation | RIntegration | RView | RParameter | RFilter | RPolicy | RStyle | RVocabs | RI18nBundle | RAuthProfile | RWorkspace | RTenant | RBehaviorBinding | RPresentationBinding | RPageTemplate | RPage | RNavigation
