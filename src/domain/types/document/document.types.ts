import type { RAction } from '@/domain/entities/reflect/RAction'
import type { RAuthProfile } from '@/domain/entities/reflect/RAuthProfile'
import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type { RComposition } from '@/domain/entities/reflect/RComposition'
import type { RComputation } from '@/domain/entities/reflect/RComputation'
import type { RConfiguration } from '@/domain/entities/reflect/RConfiguration'
import type { RConverter } from '@/domain/entities/reflect/RConverter'
import type { RDataView } from '@/domain/entities/reflect/RDataView'
import type { REnvironment } from '@/domain/entities/reflect/REnvironment'
import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { RI18nBundle } from '@/domain/entities/reflect/RI18nBundle'
import type { RIntegration } from '@/domain/entities/reflect/RIntegration'
import type { RMock } from '@/domain/entities/reflect/RMock'
import type { RNavigation } from '@/domain/entities/reflect/RNavigation'
import type { RPage } from '@/domain/entities/reflect/RPage'
import type { RPageTemplate } from '@/domain/entities/reflect/RPageTemplate'
import type { RParameter } from '@/domain/entities/reflect/RParameter'
import type { RPolicy } from '@/domain/entities/reflect/RPolicy'
import type { RProject } from '@/domain/entities/reflect/RProject'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RStore } from '@/domain/entities/reflect/RStore'
import type { RStream } from '@/domain/entities/reflect/RStream'
import type { RStyle } from '@/domain/entities/reflect/RStyle'
import type { RTenant } from '@/domain/entities/reflect/RTenant'
import type { RType } from '@/domain/entities/reflect/RType'
import type { RUpdate } from '@/domain/entities/reflect/RUpdate'
import type { RVocabs } from '@/domain/entities/reflect/RVocabs'
import type { RWorkspace } from '@/domain/entities/reflect/RWorkspace'
import type { RComponent } from '@/domain/types/component/component.types'

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
  /** Frontend-only catalog classification; Event is not a persisted document. */
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
