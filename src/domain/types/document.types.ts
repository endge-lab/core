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
import type { RScenario } from '@/domain/entities/reflect/RScenario'
import type { RSettings } from '@/domain/entities/reflect/RSettings'
import type { RPolicy } from '@/domain/entities/reflect/RPolicy'
import type { RStyle } from '@/domain/entities/reflect/RStyle'
import type { RTenant } from '@/domain/entities/reflect/RTenant'
import type { RBehaviorBinding } from '@/domain/entities/reflect/RBehaviorBinding'
import type { RPresentationBinding } from '@/domain/entities/reflect/RPresentationBinding'
import type { RVocabs } from '@/domain/entities/reflect/RVocabs'
import type { RI18nBundle } from '@/domain/entities/reflect/RI18nBundle'
import type { RComponent } from '@/domain/types/component.types'

/**
 * Разновидности типов компонентов
 */
export enum ComponentType {
  Component = 'component',
  DSL = 'component-dsl',
  Table = 'component-table',
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
  Scenario = 'scenario',
  Action = 'action',
  Converter = 'converter',
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
  Settings = 'settings',
  Project = 'project',
}

/**
 * Описывает типы скриптов
 */
export enum ScriptType {
  ScenarioSetup = 'scenario-setup',
}

/**
 * Все возможные типы документов
 */
export type DomainDocumentType
  = | 'primitive'
    | 'type'
    | 'action'
    | 'converter'
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
    | 'tenant'
    | 'settings'
    | 'project'
    | Exclude<ComponentType, ComponentType.Component>
    | QueryType
    | ScriptType
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
export type RDocument = RComponent | RQuery | RScenario | RAction | RConverter | RIntegration | RView | RParameter | RFilter | RSettings | RPolicy | RStyle | RVocabs | RI18nBundle | RTenant | RBehaviorBinding | RPresentationBinding | RPageTemplate | RPage | RNavigation
