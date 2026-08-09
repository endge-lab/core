import { EndgeFederation } from '@/domain/entities/endge/EndgeFederation'
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type { EndgeDomainBundle, EndgeDomainPlain, EndgeDomainSelection, EndgePortableDocuments } from '@/domain/types/document/domain-export.type'
import { DomainSectionType } from '@/domain/types/document/document.types'
import type { EndgeAuth } from '@/model/modules/security/endge-auth'
import type { EndgeAuthProfiles } from '@/model/modules/security/endge-auth-profiles'
import { EndgeBind } from '@/model/modules/runtime/core/endge-bind'
import { EndgeActions } from '@/model/modules/runtime/core/endge-actions'
import { EndgeContext } from '@/model/modules/context/endge-context'
import { EndgeConfigurationModule } from '@/model/modules/context/endge-configuration'
import { EndgeDataView } from '@/model/modules/runtime/execution/endge-data-view'
import { EndgeCompiler } from '@/model/modules/program/endge-compiler'
import { EndgeDiagnostics } from '@/model/modules/diagnostics/endge-diagnostics'
import { EndgeDomain } from '@/model/modules/domain/endge-domain'
import { EndgeTypes } from '@/model/modules/domain/endge-types'
import { EndgeEvents } from '@/model/modules/events/endge-events'
import { EndgeFlow } from '@/model/modules/runtime/flow/endge-flow'
import { EndgeFlowRegistry } from '@/model/modules/runtime/flow/endge-flow-registry'
import { EndgeI18n } from '@/model/modules/context/endge-i18n'
import type { EndgeMock } from '@/model/modules/mock/EndgeMock'
import { EndgeProgram } from '@/model/modules/program/endge-program'
import { EndgeQuery } from '@/model/modules/runtime/execution/endge-query'
import { EndgeRuntime } from '@/model/modules/runtime/core/endge-runtime'
import { EndgeRuntimeDebugger } from '@/model/modules/diagnostics/endge-runtime-debugger'
import { EndgeDomainRepository } from '@/model/modules/domain/endge-domain-repository'
import { EndgeSource } from '@/model/modules/program/endge-source'
import { EndgeSSE } from '@/model/modules/runtime/input/endge-sse'
import { EndgeStyles } from '@/model/modules/ui/endge-styles'
import { EndgeUI } from '@/model/modules/ui/endge-ui'
import { EndgeUpdates } from '@/model/modules/runtime/core/endge-updates'
import type { WorkspaceVariables } from '@/model/modules/context/endge-vars'
import { EndgeVocabs } from '@/model/modules/domain/endge-vocabs'
import { EndgeWorkspace } from '@/model/modules/context/endge-workspace'
import { migrateQuerySourceV1ToV2 } from '@/model/services/source-engine/migrations/query-source-v1-migration'
import { EndgeUIRegistry } from '@/model/modules/ui/endge-ui-registry'
import { ENDGE_DOMAIN_BUNDLE_VERSION } from '@/model/config/domain.config'
import { ENDGE_CORE_MODULES } from '@/model/config/modules.config'
import type { EndgeComposition } from '@/model/modules/runtime/execution/endge-composition'

/**
 * Единая статическая федерация Endge.
 * Хост живёт в `globalThis`, поэтому `Endge` не дублируется даже если пакет подтянут из разных зависимостей.
 */
export class Endge extends EndgeFederation {
  protected static override readonly federationId = 'endge'

  /**
   * Запрещает создание экземпляров `Endge`.
   * Федерация используется только через статический facade.
   */
  private constructor() {
    super()
  }

  /**
   * Описывает системные модули ядра и создает их экземпляры.
   * Порядок берется из `ENDGE_CORE_MODULES` и может быть уточнен через `before/after`.
   */
  protected static override configureFederation(): void {
    for (const item of ENDGE_CORE_MODULES) {
      this.defineModule({
        key: item.key,
        module: new item.module(),
        before: item.before,
        after: item.after,
      })
    }
  }

  /**
   * Запускает ядро по полному boot pipeline: `setup -> load -> build -> start`.
   * Метод является единственной централизованной точкой старта `Endge`.
   */
  static override async boot(ctx: EndgeBootContext): Promise<void> {
    if (this.isInitialized)
      return

    await super.boot(ctx)
  }

  /**
   * Скачивает текущий workspace и домен либо только выбранные документы как JSON-файл.
   */
  static download(selection?: readonly EndgeDomainSelection[]): void {
    const domain = selection === undefined
      ? Endge.domain.toPlain()
      : Endge.selectDomain(selection)
    const bundle = Endge.createDomainBundle(domain)
    const filenamePrefix = selection === undefined ? 'endge-domain' : 'endge-domain-selected'
    const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')
    const blob = new Blob([JSON.stringify(bundle)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = `${filenamePrefix}-${timestamp}.json`
    anchor.click()

    URL.revokeObjectURL(url)
  }

  /**
   * Возвращает domain только с перечисленными документами, сохраняя полную структуру коллекций.
   * Тип секции обязателен, потому что id сущностей уникален только внутри своей коллекции.
   */
  private static selectDomain(selection: readonly EndgeDomainSelection[]): EndgeDomainPlain {
    const selectedKeys = new Map<keyof EndgeDomainPlain, Set<string>>()
    for (const item of selection) {
      const collection = Endge.resolveSelectionCollection(item)
      if (!collection)
        continue

      const keys = selectedKeys.get(collection) ?? new Set<string>()
      keys.add(String(item.id))
      if (item.identity != null && item.identity !== '')
        keys.add(String(item.identity))
      selectedKeys.set(collection, keys)
    }

    const domain = Endge.domain.toPlain()
    return Object.fromEntries(
      (Object.entries(domain) as Array<[keyof EndgeDomainPlain, unknown[]]>).map(([collection, entities]) => {
        const keys = selectedKeys.get(collection)
        if (!keys)
          return [collection, []]

        return [collection, entities.filter((entity) => {
          if (entity == null || typeof entity !== 'object')
            return false
          const candidate = entity as { id?: string | number, identity?: string | number }
          return (candidate.id != null && keys.has(String(candidate.id)))
            || (candidate.identity != null && keys.has(String(candidate.identity)))
        })]
      }),
    ) as unknown as EndgeDomainPlain
  }

  private static createDomainBundle(domain: EndgeDomainPlain): EndgeDomainBundle {
    const workspace = Endge.workspace.serialize()
    const sse = workspace.configuration.sse ? { ...workspace.configuration.sse } : undefined
    if (sse)
      delete sse.manualToken

    const folders = Endge._portableIdentityIndex(domain.folders)
    const environments = Endge._portableIdentityIndex(domain.environments)
    const authProfiles = Endge._portableIdentityIndex(domain.authProfiles)
    const stores = Endge._portableIdentityIndex(domain.stores)
    const documents: EndgePortableDocuments = {
      projects: Endge._portableProjects(domain.projects, folders, environments),
      tenants: Endge._portableDocuments(domain.tenants, folders),
      environments: Endge._portableDocuments(domain.environments, folders),
      folders: Endge._portableFolders(domain.folders),
      types: Endge._portableDocuments(domain.types, folders),
      queries: Endge._portableQueries(domain.queries, folders),
      'data-views': Endge._portableDocuments(domain.dataViews, folders),
      compositions: Endge._portableDocuments(domain.compositions, folders),
      stores: Endge._portableDocuments(domain.stores, folders),
      streams: Endge._portableDocuments(domain.streams, folders),
      updates: Endge._portableDocuments(domain.updates, folders, { storeIdentity: stores }),
      mocks: Endge._portableDocuments(domain.mocks, folders),
      components: Endge._portableDocuments(domain.componentSFCs, folders),
      actions: Endge._portableDocuments(domain.actions, folders),
      filters: Endge._portableDocuments(domain.filters, folders),
      converters: Endge._portableDocuments(domain.converters, folders),
      computations: Endge._portableDocuments(domain.computations, folders),
      vocabs: Endge._portableDocuments(domain.vocabs, folders, { authProfileIdentity: authProfiles }),
      'i18n-bundles': Endge._portableDocuments(domain.i18nBundles, folders),
      'auth-profiles': Endge._portableDocuments(domain.authProfiles, folders),
      navigations: Endge._portableDocuments(domain.navigations, folders),
      styles: Endge._portableDocuments(domain.styles, folders),
    }

    const { installedIntegrations, ...workspaceContent } = workspace
    return {
      schemaVersion: ENDGE_DOMAIN_BUNDLE_VERSION,
      kind: 'workspace-snapshot',
      workspace: {
        ...workspaceContent,
        dataMode: workspace.dataMode === 'mock' ? 'development' : 'production',
        configuration: {
          ...workspace.configuration,
          ...(sse ? { sse } : {}),
        },
      } as EndgeDomainBundle['workspace'],
      installedIntegrations: installedIntegrations.map(item => ({
        identity: item.integrationIdentity,
        version: item.version,
        configuration: {},
      })),
      documents,
    }
  }

  /** Преобразует domain-документы в переносимые записи backend без локального состояния. */
  private static _portableDocuments(
    values: unknown[],
    folders: Map<string, string>,
    relations: Record<string, Map<string, string>> = {},
  ): Record<string, unknown>[] {
    return values.flatMap((value) => {
      if (value == null || typeof value !== 'object' || Array.isArray(value))
        return []

      const source = value as Record<string, unknown>
      const identity = String(source.identity ?? '').trim()
      if (!identity)
        return []

      const result: Record<string, unknown> = {}
      for (const [key, fieldValue] of Object.entries(source)) {
        if (['id', 'name', 'author', 'createdAt', 'updatedAt', 'deletedAt', 'revision', 'folder', 'folderId', 'origin', 'isTemporary'].includes(key))
          continue
        result[key] = fieldValue
      }
      result.identity = identity
      result.displayName = String(source.displayName ?? source.name ?? identity)
      result.managedBy = source.managedBy === 'system' || source.managedBy === 'integration' ? source.managedBy : 'user'
      result.managedById = typeof source.managedById === 'string' && source.managedById.trim() ? source.managedById.trim() : null
      result.meta = source.meta != null && typeof source.meta === 'object' && !Array.isArray(source.meta) ? source.meta : {}
      result.active = source.active !== false

      const folderIdentity = Endge._portableRelationIdentity(source.folderIdentity ?? source.folder ?? source.folderId, folders)
      if (folderIdentity)
        result.folderIdentity = folderIdentity

      for (const [field, index] of Object.entries(relations)) {
        const raw = source[field]
        if (Array.isArray(raw)) {
          result[field] = raw.map(item => Endge._portableRelationIdentity(item, index)).filter(Boolean)
        }
        else {
          const relationIdentity = Endge._portableRelationIdentity(raw, index)
          if (relationIdentity)
            result[field] = relationIdentity
        }
      }

      return [result]
    })
  }

  /** Переводит legacy Query source в обязательный portable Query v2 contract. */
  private static _portableQueries(values: unknown[], folders: Map<string, string>): Record<string, unknown>[] {
    return Endge._portableDocuments(values, folders).map((query) => {
      if (Number(query.sourceVersion) !== 1)
        return query

      const identity = String(query.identity ?? '').trim()
      const migration = migrateQuerySourceV1ToV2(String(query.source ?? ''))
      if (!migration.ok)
        throw new Error(`Query "${identity}" cannot be exported: ${migration.message}`)

      return {
        ...query,
        source: migration.source,
        sourceVersion: migration.sourceVersion,
      }
    })
  }

  /** Удаляет устаревшие Project-поля и переводит environments relation в identity. */
  private static _portableProjects(values: unknown[], folders: Map<string, string>, environments: Map<string, string>): Record<string, unknown>[] {
    return Endge._portableDocuments(values, folders).map((project) => {
      const source = values.find(value => value != null && typeof value === 'object' && String((value as any).identity) === project.identity) as Record<string, unknown> | undefined
      const relation = source?.allowedEnvironments ?? source?.allowedEnvironmentIds ?? source?.allowedEnvironmentIdentities
      project.allowedEnvironments = (Array.isArray(relation) ? relation : [])
        .map(item => Endge._portableRelationIdentity(item, environments))
        .filter(Boolean)
      for (const field of ['slug', 'order', 'sortOrder', 'navigation', 'navigationId', 'navigationIdentity', 'allowedEnvironmentIds', 'allowedEnvironmentIdentities'])
        delete project[field]
      return project
    })
  }

  /** Преобразует пользовательские папки и их parent relation в identity-контракт snapshot. */
  private static _portableFolders(values: unknown[]): Record<string, unknown>[] {
    const identities = Endge._portableIdentityIndex(values)
    return Endge._portableDocuments(values, identities).filter((folder) => {
      const entityType = String(folder.entityType ?? '').trim()
      return folder.identity !== `root-${entityType}`
    }).map((folder) => {
      const source = values.find(value => value != null && typeof value === 'object' && String((value as any).identity) === folder.identity) as Record<string, unknown> | undefined
      const parentIdentity = Endge._portableRelationIdentity(source?.parentIdentity ?? source?.parent ?? source?.parentId, identities)
      delete folder.folderIdentity
      if (parentIdentity)
        folder.parentIdentity = parentIdentity
      return folder
    })
  }

  /** Строит соответствие runtime id -> стабильная identity для portable relations. */
  private static _portableIdentityIndex(values: unknown[]): Map<string, string> {
    const result = new Map<string, string>()
    for (const value of values) {
      if (value == null || typeof value !== 'object' || Array.isArray(value))
        continue
      const item = value as Record<string, unknown>
      const identity = String(item.identity ?? '').trim()
      if (!identity)
        continue
      result.set(identity, identity)
      if (item.id != null)
        result.set(String(item.id), identity)
    }
    return result
  }

  /** Разрешает relation object, runtime id или готовую identity в стабильную identity. */
  private static _portableRelationIdentity(value: unknown, index: Map<string, string>): string | null {
    if (value == null)
      return null
    if (typeof value === 'object' && !Array.isArray(value)) {
      const relation = value as Record<string, unknown>
      const directIdentity = String(relation.identity ?? '').trim()
      if (directIdentity)
        return directIdentity
      return Endge._portableRelationIdentity(relation.value ?? relation.id, index)
    }
    return index.get(String(value)) ?? null
  }

  private static resolveSelectionCollection(selection: EndgeDomainSelection): (keyof EndgeDomainPlain) | null {
    switch (selection.sectionType) {
      case DomainSectionType.Primitive:
      case DomainSectionType.Type:
        return 'types'
      case DomainSectionType.Component:
        return selection.docType === 'component-sfc' ? 'componentSFCs' : 'components'
      case DomainSectionType.Query:
        return 'queries'
      case DomainSectionType.DataView:
        return 'dataViews'
      case DomainSectionType.Composition:
        return 'compositions'
      case DomainSectionType.Store:
        return 'stores'
      case DomainSectionType.Mock:
        return 'mocks'
      case DomainSectionType.Action:
        return 'actions'
      case DomainSectionType.Converter:
        return 'converters'
      case DomainSectionType.Computation:
        return 'computations'
      case DomainSectionType.Integration:
        return 'integrations'
      case DomainSectionType.Parameters:
        return 'parameters'
      case DomainSectionType.Filters:
        return 'filters'
      case DomainSectionType.Environment:
        return 'environments'
      case DomainSectionType.Tenant:
        return 'tenants'
      case DomainSectionType.Policy:
        return 'policies'
      case DomainSectionType.Style:
        return 'styles'
      case DomainSectionType.PageTemplate:
        return 'pageTemplates'
      case DomainSectionType.Page:
        return 'pages'
      case DomainSectionType.Navigation:
        return 'navigations'
      case DomainSectionType.Vocabs:
        return 'vocabs'
      case DomainSectionType.I18nBundles:
        return 'i18nBundles'
      case DomainSectionType.AuthProfile:
        return 'authProfiles'
      case DomainSectionType.Project:
        return 'projects'
      default:
        return null
    }
  }

  /**
   * Доступ к централизованному модулю logs, spans и adapters.
   */
  static get diagnostics(): EndgeDiagnostics {
    return this.getModule<EndgeDiagnostics>('diagnostics')
  }

  /**
   * Доступ к persisted domain model.
   */
  static get domain(): EndgeDomain {
    return this.getModule<EndgeDomain>('domain')
  }

  /** Доступ к effective registry встроенных и пользовательских типов. */
  static get types(): EndgeTypes {
    return this.getModule<EndgeTypes>('types')
  }

  /**
   * Доступ к compiled program read-model.
   */
  static get program(): EndgeProgram {
    return this.getModule<EndgeProgram>('program')
  }

  /**
   * Доступ к компилятору домена в program artifacts.
   */
  static get compiler(): EndgeCompiler {
    return this.getModule<EndgeCompiler>('compiler')
  }

  /**
   * Доступ к authoring-модулю source-документов.
   */
  static get source(): EndgeSource {
    return this.getModule<EndgeSource>('source')
  }

  /**
   * Доступ к registry mock payload.
   */
  static get mock(): EndgeMock {
    return this.getModule<EndgeMock>('mock')
  }

  /**
   * Доступ к модулю словарей.
   */
  static get vocabs(): EndgeVocabs {
    return this.getModule<EndgeVocabs>('vocabs')
  }

  /**
   * Доступ к модулю переводов из доменных i18n-bundles.
   */
  static get i18n(): EndgeI18n {
    return this.getModule<EndgeI18n>('i18n')
  }

  /**
   * @deprecated Используйте Endge.runtime.flowRegistry.
   */
  static get flowRegistry(): EndgeFlowRegistry {
    return this.runtime.flowRegistry
  }

  /**
   * @deprecated Используйте Endge.runtime.flow.
   */
  static get flow(): EndgeFlow {
    return this.runtime.flow
  }

  /**
   * Доступ к runtime host manager.
   */
  static get runtime(): EndgeRuntime {
    return this.getModule<EndgeRuntime>('runtime')
  }

  /**
   * @deprecated Используйте Endge.workspace.variables.
   */
  static get vars(): WorkspaceVariables {
    return this.workspace.variables
  }

  /**
   * @deprecated Используйте Endge.runtime.query.
   */
  static get query(): EndgeQuery {
    return this.runtime.query
  }

  /**
   * @deprecated Используйте Endge.runtime.dataView.
   */
  static get dataView(): EndgeDataView {
    return this.runtime.dataView
  }

  /** @deprecated Используйте Endge.runtime.composition. */
  static get composition(): EndgeComposition {
    return this.runtime.composition
  }

  /**
   * Доступ к auth-модулю.
   */
  static get auth(): EndgeAuth {
    return this.getModule<EndgeAuth>('auth')
  }

  /**
   * @deprecated Используйте Endge.auth.profiles.
   */
  static get authProfiles(): EndgeAuthProfiles {
    return this.auth.profiles
  }

  /**
   * Доступ к repository persisted domain.
   */
  static get domainRepository(): EndgeDomainRepository {
    return this.getModule<EndgeDomainRepository>('domainRepository')
  }

  /**
   * Доступ к модулю приема updates.
   */
  static get updates(): EndgeUpdates {
    return this.getModule<EndgeUpdates>('updates')
  }

  /**
   * Доступ к event bus модулю.
   */
  static get events(): EndgeEvents {
    return this.getModule<EndgeEvents>('events')
  }

  /**
   * Доступ к SSE-модулю.
   */
  static get sse(): EndgeSSE {
    return this.getModule<EndgeSSE>('sse')
  }

  /**
   * Доступ к UI state модулю.
   */
  static get ui(): EndgeUI {
    return this.getModule<EndgeUI>('ui')
  }

  /**
   * Доступ к UI registry компонентов, renderers и presets.
   */
  static get uiRegistry(): EndgeUIRegistry {
    return this.getModule<EndgeUIRegistry>('uiRegistry')
  }

  /**
   * Доступ к registry runtime bindings.
   */
  static get bind(): EndgeBind {
    return this.getModule<EndgeBind>('bind')
  }

  /** Доступ к единому registry вызываемых runtime Actions. */
  static get actions(): EndgeActions {
    return this.runtime.actions
  }

  /**
   * Доступ к runtime debugger.
   */
  static get runtimeDebugger(): EndgeRuntimeDebugger {
    return this.getModule<EndgeRuntimeDebugger>('runtimeDebugger')
  }

  /**
   * Доступ к модулю компиляции и применения стилей.
   */
  static get styles(): EndgeStyles {
    return this.getModule<EndgeStyles>('styles')
  }

  /**
   * Доступ к прикладному контексту ядра: проект, окружение, локаль.
   */
  static get context(): EndgeContext {
    return this.getModule<EndgeContext>('context')
  }

  /** Доступ к effective configuration и immutable compiler build context. */
  static get configuration(): EndgeConfigurationModule {
    return this.getModule<EndgeConfigurationModule>('configuration')
  }

  /**
   * Доступ к frontend workspace profile: локали и будущие runtime capabilities.
   */
  static get workspace(): EndgeWorkspace {
    return this.getModule<EndgeWorkspace>('workspace')
  }
}
