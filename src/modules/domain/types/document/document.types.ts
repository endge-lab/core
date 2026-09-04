import type { RAction } from '@/modules/domain/entities/RAction'
import type { RAuthProfile } from '@/modules/domain/entities/RAuthProfile'
import type { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'
import type { RComposition } from '@/modules/domain/entities/RComposition'
import type { RComputation } from '@/modules/domain/entities/RComputation'
import type { RConfiguration } from '@/modules/domain/entities/RConfiguration'
import type { RConverter } from '@/modules/domain/entities/RConverter'
import type { RDataView } from '@/modules/domain/entities/RDataView'
import type { REnvironment } from '@/modules/domain/entities/REnvironment'
import type { RFilter } from '@/modules/domain/entities/RFilter'
import type { RI18nBundle } from '@/modules/domain/entities/RI18nBundle'
import type { RIntegration } from '@/modules/domain/entities/RIntegration'
import type { RMock } from '@/modules/domain/entities/RMock'
import type { RNavigation } from '@/modules/domain/entities/RNavigation'
import type { RPage } from '@/modules/domain/entities/RPage'
import type { RPageTemplate } from '@/modules/domain/entities/RPageTemplate'
import type { RParameter } from '@/modules/domain/entities/RParameter'
import type { RPolicy } from '@/modules/domain/entities/RPolicy'
import type { RProject } from '@/modules/domain/entities/RProject'
import type { RQuery } from '@/modules/domain/entities/RQuery'
import type { RStore } from '@/modules/domain/entities/RStore'
import type { RStream } from '@/modules/domain/entities/RStream'
import type { RStyle } from '@/modules/domain/entities/RStyle'
import type { RTenant } from '@/modules/domain/entities/RTenant'
import type { RType } from '@/modules/domain/entities/RType'
import type { RUpdate } from '@/modules/domain/entities/RUpdate'
import type { RVocabs } from '@/modules/domain/entities/RVocabs'
import type { RWorkspace } from '@/modules/domain/entities/RWorkspace'
import type { RComponent } from '@/modules/domain/types/component/component.types'

/**
 * Разновидности типов компонентов
 */
export enum ComponentType {
  Component = 'component',
  /** Legacy-тип шаблона колонки таблицы; не является отдельным документом. */
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
  /** Классификация каталога только для frontend; Event не является сохраняемым документом. */
  Event = 'event',
  Converter = 'converter',
  Computation = 'computation',
  Integration = 'integration',
  Parameters = 'parameters',
  Filters = 'filters',
  Environment = 'environment',
  Tenant = 'tenant',
  Policy = 'policy',
  Style = 'style',
  Configuration = 'configuration',
  PageTemplate = 'page-template',
  Page = 'page',
  Navigation = 'navigation',
  Vocabs = 'vocabs',
  I18nBundles = 'i18n-bundles',
  AuthProfile = 'auth-profile',
  Project = 'project',
}

/** Канонический исчерпывающий список типов документов Domain. */
export const DOMAIN_DOCUMENT_TYPES = [
  'primitive',
  'type',
  'action',
  'converter',
  'computation',
  'data-view',
  'composition',
  'store',
  'stream',
  'update',
  'mock',
  'integration',
  'page-template',
  'page',
  'navigation',
  'environment',
  'policy',
  'style',
  'configuration',
  'vocabs',
  'i18n-bundles',
  'auth-profile',
  'tenant',
  'project',
  'workspace',
  ComponentType.DSL,
  ComponentType.Table,
  ComponentType.SFC,
  QueryType.Custom,
  QueryType.GraphQL,
  QueryType.REST,
  ParameterType.DefaultParameter,
  FilterType.DefaultFilter,
] as const

/** Все возможные типы документов. */
export type DomainDocumentType = (typeof DOMAIN_DOCUMENT_TYPES)[number]

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
export type RDocument = RComponent | RComponentSFC | RQuery | RDataView | RComposition | RStore | RStream | RUpdate | RMock | RAction | RConverter | RComputation | RIntegration | RParameter | RFilter | RPolicy | RStyle | RConfiguration | RType | RVocabs | RI18nBundle | RAuthProfile | RWorkspace | RTenant | RProject | REnvironment | RPageTemplate | RPage | RNavigation
