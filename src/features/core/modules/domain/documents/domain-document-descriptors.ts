import type { DocumentSerializationContext } from '@/features/core/modules/domain/documents/service-document-serializer'
import type { RComponent } from '@/features/core/modules/domain/types/component/component.types'
import type { DocumentDraftOptions } from '@/features/core/modules/domain/types/document/document-draft.type'
import type { DomainDocumentType } from '@/features/core/modules/domain/types/document/document.types'
import type { EndgeDomainCollection } from '@/features/core/modules/domain/types/document/domain-provider.type'
import type { ProgramEntityType } from '@/features/core/modules/program/domain/types/program.types'
import type { RuntimeEntityType } from '@/features/core/modules/runtime/domain/runtime-entity-map.types'
import type { SourceKind } from '@/features/core/modules/source/domain/types/source-engine.types'

import { Serialize } from '@endge/utils'

import { serializeServiceDocument } from '@/features/core/modules/domain/documents/service-document-serializer'
import { RAction } from '@/features/core/modules/domain/entities/RAction'
import { RAuthProfile } from '@/features/core/modules/domain/entities/RAuthProfile'
import { ReflectComponentFromPlain } from '@/features/core/modules/domain/entities/RComponent'
import { RComponentDSL } from '@/features/core/modules/domain/entities/RComponentDSL'
import { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import { RComponentTable } from '@/features/core/modules/domain/entities/RComponentTable'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import { RComputation } from '@/features/core/modules/domain/entities/RComputation'
import { RConfiguration } from '@/features/core/modules/domain/entities/RConfiguration'
import { RConverter } from '@/features/core/modules/domain/entities/RConverter'
import { RDataView } from '@/features/core/modules/domain/entities/RDataView'
import { REnvironment } from '@/features/core/modules/domain/entities/REnvironment'
import { RFilter } from '@/features/core/modules/domain/entities/RFilter'
import { RI18nBundle } from '@/features/core/modules/domain/entities/RI18nBundle'
import { RIntegration } from '@/features/core/modules/domain/entities/RIntegration'
import { RMock } from '@/features/core/modules/domain/entities/RMock'
import { RNavigation } from '@/features/core/modules/domain/entities/RNavigation'
import { RPage } from '@/features/core/modules/domain/entities/RPage'
import { RPageTemplate } from '@/features/core/modules/domain/entities/RPageTemplate'
import { RParameter } from '@/features/core/modules/domain/entities/RParameter'
import { RPolicy } from '@/features/core/modules/domain/entities/RPolicy'
import { RProject } from '@/features/core/modules/domain/entities/RProject'
import { RQuery } from '@/features/core/modules/domain/entities/RQuery'
import { RStore } from '@/features/core/modules/domain/entities/RStore'
import { RStream } from '@/features/core/modules/domain/entities/RStream'
import { RStyle } from '@/features/core/modules/domain/entities/RStyle'
import { RTenant } from '@/features/core/modules/domain/entities/RTenant'
import { RType } from '@/features/core/modules/domain/entities/RType'
import { RUpdate } from '@/features/core/modules/domain/entities/RUpdate'
import { RVocabs } from '@/features/core/modules/domain/entities/RVocabs'
import { RWorkspace } from '@/features/core/modules/domain/entities/RWorkspace'
import { ComponentType, DOMAIN_DOCUMENT_TYPES, DomainSectionType, FilterType, ParameterType, QueryType } from '@/features/core/modules/domain/types/document/document.types'
import { ACTION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/action.default.source'
import { COMPONENT_SFC_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/component-sfc/component-sfc.default.source'
import { COMPOSITION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/composition.default.source'
import { COMPUTATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/computation.default.source'
import { DATA_VIEW_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/data-view.default.source'
import { FILTER_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/filter.default.source'
import { QUERY_DEFAULT_SOURCE, QUERY_GRAPHQL_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/query.default.source'
import { STORE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/store.default.source'
import { STREAM_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/stream.default.source'
import { TYPE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/type.default.source'
import { UPDATE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/update.default.source'

export type DomainCollectionKey
  = | 'projects' | 'types' | 'queries' | 'dataViews' | 'compositions' | 'stores'
    | 'streams' | 'updates' | 'mocks' | 'componentSFCs' | 'actions' | 'filters'
    | 'converters' | 'computations' | 'environments' | 'tenants' | 'styles' | 'configurations'
    | 'vocabs' | 'authProfiles' | 'i18nBundles' | 'navigations'

/** Точное соответствие document type конкретной Domain-модели. */
export interface DomainDocumentModelMap {
  'primitive': RType
  'type': RType
  'action': RAction
  'converter': RConverter
  'computation': RComputation
  'data-view': RDataView
  'composition': RComposition
  'store': RStore
  'stream': RStream
  'update': RUpdate
  'mock': RMock
  'integration': RIntegration
  'page-template': RPageTemplate
  'page': RPage
  'navigation': RNavigation
  'environment': REnvironment
  'policy': RPolicy
  'style': RStyle
  'configuration': RConfiguration
  'vocabs': RVocabs
  'i18n-bundles': RI18nBundle
  'auth-profile': RAuthProfile
  'tenant': RTenant
  'project': RProject
  'workspace': RWorkspace
  [ComponentType.DSL]: RComponentDSL
  [ComponentType.Table]: RComponentTable
  [ComponentType.SFC]: RComponentSFC
  [QueryType.Custom]: RQuery
  [QueryType.GraphQL]: RQuery
  [QueryType.REST]: RQuery
  [ParameterType.DefaultParameter]: RParameter
  [FilterType.DefaultFilter]: RFilter
}

export interface DomainDocumentCapabilityMetadata {
  source: SourceKind | 'component-sfc' | null
  program: ProgramEntityType | null
  runtime: RuntimeEntityType | null
}

export interface DomainDocumentPersistenceDescriptor {
  collection: EndgeDomainCollection
  serialize: (source: unknown, context: DocumentSerializationContext) => Record<string, unknown>
}

export interface DomainDocumentDescriptor<TType extends DomainDocumentType = DomainDocumentType> {
  type: TType
  section: DomainSectionType
  domainCollection: DomainCollectionKey | null
  materialize: (source: Record<string, unknown>) => DomainDocumentModelMap[TType]
  createNew: ((options: DocumentDraftOptions) => DomainDocumentModelMap[TType]) | null
  structuralValidationOwner: 'entity'
  persistence: DomainDocumentPersistenceDescriptor | null
  capabilities: DomainDocumentCapabilityMetadata
}

type MaterializerMap = { [TType in DomainDocumentType]: (source: Record<string, unknown>) => DomainDocumentModelMap[TType] }

const MATERIALIZERS: MaterializerMap = {
  'primitive': source => Serialize.fromJSON(RType, source),
  'type': source => Serialize.fromJSON(RType, source),
  'action': source => Serialize.fromJSON(RAction, source),
  'converter': source => Serialize.fromJSON(RConverter, source),
  'computation': source => RComputation.fromPlain(source),
  'data-view': source => Serialize.fromJSON(RDataView, source),
  'composition': source => RComposition.fromPlain(source),
  'store': source => Serialize.fromJSON(RStore, source),
  'stream': source => Serialize.fromJSON(RStream, source),
  'update': source => Serialize.fromJSON(RUpdate, source),
  'mock': source => RMock.fromPlain(source),
  'integration': source => Serialize.fromJSON(RIntegration, source),
  'page-template': source => Serialize.fromJSON(RPageTemplate, source),
  'page': source => Serialize.fromJSON(RPage, source),
  'navigation': source => Serialize.fromJSON(RNavigation, source),
  'environment': source => REnvironment.fromPlain(source),
  'policy': source => Serialize.fromJSON(RPolicy, source),
  'style': source => RStyle.fromPlain(source),
  'configuration': source => RConfiguration.fromPlain(source),
  'vocabs': source => RVocabs.fromPlain(source),
  'i18n-bundles': source => Serialize.fromJSON(RI18nBundle, source),
  'auth-profile': source => RAuthProfile.fromPlain(source),
  'tenant': source => Serialize.fromJSON(RTenant, source),
  'project': source => RProject.fromPlain(source),
  'workspace': source => RWorkspace.fromPlain(source),
  [ComponentType.DSL]: source => requireComponent(source, ComponentType.DSL) as RComponentDSL,
  [ComponentType.Table]: source => requireComponent(source, ComponentType.Table) as RComponentTable,
  [ComponentType.SFC]: source => RComponentSFC.fromPlain(source),
  [QueryType.Custom]: source => Serialize.fromJSON(RQuery, source),
  [QueryType.GraphQL]: source => Serialize.fromJSON(RQuery, source),
  [QueryType.REST]: source => Serialize.fromJSON(RQuery, source),
  [ParameterType.DefaultParameter]: source => RParameter.fromPlain(source as never),
  [FilterType.DefaultFilter]: source => RFilter.fromPlain(source as never),
}

const SECTION_BY_TYPE: Record<DomainDocumentType, DomainSectionType> = {
  'primitive': DomainSectionType.Primitive,
  'type': DomainSectionType.Type,
  'action': DomainSectionType.Action,
  'converter': DomainSectionType.Converter,
  'computation': DomainSectionType.Computation,
  'data-view': DomainSectionType.DataView,
  'composition': DomainSectionType.Composition,
  'store': DomainSectionType.Store,
  'stream': DomainSectionType.Integration,
  'update': DomainSectionType.Store,
  'mock': DomainSectionType.Mock,
  'integration': DomainSectionType.Integration,
  'page-template': DomainSectionType.PageTemplate,
  'page': DomainSectionType.Page,
  'navigation': DomainSectionType.Navigation,
  'environment': DomainSectionType.Environment,
  'policy': DomainSectionType.Policy,
  'style': DomainSectionType.Style,
  'configuration': DomainSectionType.Configuration,
  'vocabs': DomainSectionType.Vocabs,
  'i18n-bundles': DomainSectionType.I18nBundles,
  'auth-profile': DomainSectionType.AuthProfile,
  'tenant': DomainSectionType.Tenant,
  'project': DomainSectionType.Project,
  'workspace': DomainSectionType.Project,
  [ComponentType.DSL]: DomainSectionType.Component,
  [ComponentType.Table]: DomainSectionType.Component,
  [ComponentType.SFC]: DomainSectionType.Component,
  [QueryType.Custom]: DomainSectionType.Query,
  [QueryType.GraphQL]: DomainSectionType.Query,
  [QueryType.REST]: DomainSectionType.Query,
  [ParameterType.DefaultParameter]: DomainSectionType.Parameters,
  [FilterType.DefaultFilter]: DomainSectionType.Filters,
}

const DOMAIN_COLLECTION_BY_TYPE: Partial<Record<DomainDocumentType, DomainCollectionKey>> = {
  'primitive': 'types',
  'type': 'types',
  'action': 'actions',
  'converter': 'converters',
  'computation': 'computations',
  'data-view': 'dataViews',
  'composition': 'compositions',
  'store': 'stores',
  'stream': 'streams',
  'update': 'updates',
  'mock': 'mocks',
  'navigation': 'navigations',
  'environment': 'environments',
  'style': 'styles',
  'configuration': 'configurations',
  'vocabs': 'vocabs',
  'i18n-bundles': 'i18nBundles',
  'auth-profile': 'authProfiles',
  'tenant': 'tenants',
  'project': 'projects',
  [ComponentType.SFC]: 'componentSFCs',
  [QueryType.Custom]: 'queries',
  [QueryType.GraphQL]: 'queries',
  [QueryType.REST]: 'queries',
  [FilterType.DefaultFilter]: 'filters',
}

const PERSISTENCE_COLLECTION_BY_TYPE: Partial<Record<DomainDocumentType, EndgeDomainCollection>> = {
  'primitive': 'types',
  'type': 'types',
  'action': 'actions',
  'converter': 'converters',
  'computation': 'computations',
  'data-view': 'data-views',
  'composition': 'compositions',
  'store': 'stores',
  'stream': 'streams',
  'update': 'updates',
  'mock': 'mocks',
  'navigation': 'navigations',
  'environment': 'environments',
  'style': 'styles',
  'configuration': 'configurations',
  'vocabs': 'vocabs',
  'i18n-bundles': 'i18n-bundles',
  'auth-profile': 'auth-profiles',
  'tenant': 'tenants',
  'project': 'projects',
  [ComponentType.SFC]: 'components',
  [QueryType.Custom]: 'queries',
  [QueryType.GraphQL]: 'queries',
  [QueryType.REST]: 'queries',
  [FilterType.DefaultFilter]: 'filters',
}

const CAPABILITIES_BY_TYPE: Partial<Record<DomainDocumentType, Partial<DomainDocumentCapabilityMetadata>>> = {
  'primitive': { source: 'type', program: 'type' },
  'type': { source: 'type', program: 'type' },
  'action': { source: 'action', program: 'action', runtime: 'action' },
  'computation': { source: 'computation', program: 'computation' },
  'data-view': { source: 'data-view', program: 'data-view' },
  'composition': { source: 'composition', program: 'composition', runtime: 'composition' },
  'store': { source: 'store', program: 'store', runtime: 'store' },
  'stream': { source: 'stream', program: 'stream', runtime: 'stream' },
  'update': { source: 'update', program: 'update' },
  'style': { source: 'style', program: 'style' },
  'configuration': { source: 'configuration', program: 'configuration' },
  'vocabs': { source: 'vocab', program: 'vocab' },
  [ComponentType.SFC]: { source: 'component-sfc', program: 'component-sfc', runtime: 'component-sfc' },
  [QueryType.Custom]: { source: 'query', program: 'query', runtime: 'query' },
  [QueryType.GraphQL]: { source: 'query', program: 'query', runtime: 'query' },
  [QueryType.REST]: { source: 'query', program: 'query', runtime: 'query' },
  [FilterType.DefaultFilter]: { source: 'filter', program: 'filter', runtime: 'filter' },
  'page': { runtime: 'page' },
  'project': { runtime: 'project' },
}

const CREATE_NEW_BY_TYPE: Partial<{ [TType in DomainDocumentType]: (options: DocumentDraftOptions) => DomainDocumentModelMap[TType] }> = {
  [ComponentType.DSL]: options => initialize(new RComponentDSL(), options, { type: ComponentType.DSL, groupFromFolder: true }),
  [ComponentType.Table]: options => initialize(new RComponentTable(), options, { type: ComponentType.Table, groupFromFolder: true }),
  [ComponentType.SFC]: options => initialize(new RComponentSFC(), options, {
    source: COMPONENT_SFC_DEFAULT_SOURCE,
    supportedTargets: ['dom', 'canvas'],
    modelVersion: 1,
  }),
  [QueryType.Custom]: options => createQuery(QueryType.Custom, options),
  [QueryType.GraphQL]: options => createQuery(QueryType.GraphQL, options),
  [QueryType.REST]: options => createQuery(QueryType.REST, options),
  'data-view': options => initialize(new RDataView(), options, { source: DATA_VIEW_DEFAULT_SOURCE, sourceVersion: 1 }),
  'composition': options => initialize(new RComposition(), options, {
    kind: 'library',
    kindIdentity: null,
    source: COMPOSITION_DEFAULT_SOURCE,
    sourceVersion: 1,
  }),
  'store': options => initialize(new RStore(), options, { source: STORE_DEFAULT_SOURCE, sourceVersion: 1 }),
  'stream': options => initialize(new RStream(), options, { source: STREAM_DEFAULT_SOURCE, sourceVersion: 1 }),
  'update': options => initialize(new RUpdate(), options, { source: UPDATE_DEFAULT_SOURCE, sourceVersion: 1, omitFolder: true }),
  'mock': options => initialize(new RMock(), options, { contentSource: 'document', contentType: 'application/json', source: '{}' }),
  'computation': options => initialize(new RComputation(), options, { source: COMPUTATION_DEFAULT_SOURCE, sourceVersion: 1, contractVersion: 1 }),
  'type': options => initialize(new RType(options.identity.trim()), options, { isPrimitive: false, source: TYPE_DEFAULT_SOURCE, sourceVersion: 1 }),
  [FilterType.DefaultFilter]: options => initialize(new RFilter(), options, { source: FILTER_DEFAULT_SOURCE, sourceVersion: 1 }),
  'action': options => initialize(new RAction(), options, { source: ACTION_DEFAULT_SOURCE, sourceVersion: 1 }),
  'integration': options => initialize(new RIntegration(), options),
  'environment': options => initialize(new REnvironment(), options),
  'policy': options => initialize(new RPolicy(), options),
  'tenant': options => initialize(new RTenant(), options, { codeFromIdentity: true }),
  'style': options => initialize(new RStyle(), options, { sourceVersion: 1 }),
  'configuration': options => initialize(new RConfiguration(), options, { omitFolder: true }),
  'page-template': options => initialize(new RPageTemplate(), options),
  'page': options => initialize(new RPage(), options),
  'navigation': options => initialize(new RNavigation(), options),
  'vocabs': options => initialize(new RVocabs(), options, { mode: 'internal', active: true }),
  'i18n-bundles': options => initialize(new RI18nBundle(), options, { locales: { ru: {}, en: {} }, active: true }),
  'auth-profile': options => initialize(new RAuthProfile(), options, {
    adapterId: 'bearer',
    config: {},
    credentials: { token: '{TOKEN}' },
    session: undefined,
    active: true,
  }),
}

type DescriptorMap = { [TType in DomainDocumentType]: DomainDocumentDescriptor<TType> }

export const DOMAIN_DOCUMENT_DESCRIPTORS = Object.freeze(Object.fromEntries(
  DOMAIN_DOCUMENT_TYPES.map((type) => {
    const collection = PERSISTENCE_COLLECTION_BY_TYPE[type]
    const capability = CAPABILITIES_BY_TYPE[type]
    return [type, Object.freeze({
      type,
      section: SECTION_BY_TYPE[type],
      domainCollection: DOMAIN_COLLECTION_BY_TYPE[type] ?? null,
      materialize: MATERIALIZERS[type],
      createNew: CREATE_NEW_BY_TYPE[type] ?? null,
      structuralValidationOwner: 'entity' as const,
      persistence: collection
        ? Object.freeze({
            collection,
            serialize: (source: unknown, context: DocumentSerializationContext) => serializeServiceDocument(type, source, context),
          })
        : null,
      capabilities: Object.freeze({
        source: capability?.source ?? null,
        program: capability?.program ?? null,
        runtime: capability?.runtime ?? null,
      }),
    })]
  }),
)) as DescriptorMap

/** Возвращает канонический descriptor конкретного document type. */
export function getDomainDocumentDescriptor<TType extends DomainDocumentType>(
  type: TType,
): DomainDocumentDescriptor<TType> {
  return DOMAIN_DOCUMENT_DESCRIPTORS[type]
}

/** Создаёт новый Domain-документ через канонический descriptor. */
export function createNewDomainDocument<TType extends DomainDocumentType>(
  type: TType,
  options: DocumentDraftOptions,
): DomainDocumentModelMap[TType] {
  const create = getDomainDocumentDescriptor(type).createNew
  if (!create) {
    throw new Error(`Document type does not support creation: ${type}`)
  }
  return create(options)
}

function createQuery(type: QueryType, options: DocumentDraftOptions): RQuery {
  return initialize(new RQuery(), options, {
    type,
    source: type === QueryType.GraphQL ? QUERY_GRAPHQL_DEFAULT_SOURCE : QUERY_DEFAULT_SOURCE,
    sourceVersion: 2,
  })
}

function initialize<T extends object>(
  entity: T,
  options: DocumentDraftOptions,
  values: Record<string, unknown> = {},
): T {
  const identity = options.identity.trim()
  if (!identity) {
    throw new Error('Document identity is required.')
  }
  const target = entity as Record<string, unknown>
  const title = options.name?.trim() || identity
  target.identity = identity
  target.name = title
  if ('displayName' in target) {
    target.displayName = title
  }
  const { groupFromFolder, omitFolder, codeFromIdentity, ...assign } = values
  Object.assign(target, assign)
  if (codeFromIdentity === true) {
    target.code = identity
  }
  if (omitFolder !== true && options.folderId != null) {
    target.folderId = options.folderId
    if (groupFromFolder === true) {
      target.group = options.folderId
    }
  }
  if (omitFolder === true && 'folderId' in target) {
    target.folderId = null
  }
  return entity
}

function requireComponent(source: Record<string, unknown>, type: ComponentType): RComponent {
  const component = ReflectComponentFromPlain({ ...source, type })
  if (!component) {
    throw new Error(`Failed to materialize component document: ${type}`)
  }
  return component
}
