import type { DomainDocumentType } from '@/domain/types/document/document.types'
import type {
  EndgeSchemaDump,
  EndgeSchemaError,
  RepositoriesBag,
} from '@/domain/types/document/schema.types'
import type { EndgeFlowDefinition } from '@/domain/types/flow/endge-flow.types'
import type { QueriesPayloadFields } from '@/model/db/repositories/Queries_Repository'
import type { AxiosError, AxiosInstance } from 'axios'

import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'

import { AppBus, Serialize } from '@endge/utils'
import axios from 'axios'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { ReflectComponentToPayloadData, ReflectComponentToPlain } from '@/domain/entities/reflect/RComponent'
import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { RVersion } from '@/domain/entities/reflect/RVersion'
import { ComponentType, FilterType, ParameterType, QueryType } from '@/domain/types/document/document.types'
import { Endge } from '@/model/endge/kernel/endge'
import { compositionPayloadDocToPlain, dataViewPayloadDocToPlain, mockPayloadDocToPlain, queryPayloadDocToPlain, storePayloadDocToPlain } from '@/model/endge/domain/endge-domain'
import { Actions_Repository } from '@/model/db/repositories/Actions_Repository'
import { AuthProfiles_Repository } from '@/model/db/repositories/AuthProfiles_Repository'
import { BehaviorBindings_Repository } from '@/model/db/repositories/BehaviorBindings_Repository'
import { Components_Repository } from '@/model/db/repositories/Components_Repository'
import { ComponentSFCs_Repository } from '@/model/db/repositories/ComponentSFCs_Repository'
import { Compositions_Repository } from '@/model/db/repositories/Compositions_Repository'
import { Stores_Repository } from '@/model/db/repositories/Stores_Repository'
import { Mocks_Repository } from '@/model/db/repositories/Mocks_Repository'
import { Converters_Repository } from '@/model/db/repositories/Converters_Repository'
import { DataViews_Repository } from '@/model/db/repositories/DataViews_Repository'
import { Environments_Repository } from '@/model/db/repositories/Environments_Repository'
import { Filters_Repository } from '@/model/db/repositories/Filters_Repository'
import { Folders_Repository } from '@/model/db/repositories/Folders_Repository'
import { Integrations_Repository } from '@/model/db/repositories/Integrations_Repository'
import { Navigations_Repository } from '@/model/db/repositories/Navigations_Repository'
import { Pages_Repository } from '@/model/db/repositories/Pages_Repository'
import { PageTemplates_Repository } from '@/model/db/repositories/PageTemplates_Repository'
import { Parameters_Repository } from '@/model/db/repositories/Parameters_Repository'
import { Policies_Repository } from '@/model/db/repositories/Policies_Repository'
import { PresentationBindings_Repository } from '@/model/db/repositories/PresentationBindings_Repository'
import { Projects_Repository } from '@/model/db/repositories/Projects_Repository'
import { Queries_Repository } from '@/model/db/repositories/Queries_Repository'
import { Styles_Repository } from '@/model/db/repositories/Styles_Repository'
import { Tenants_Repository } from '@/model/db/repositories/Tenants_Repository'
import { Types_Repository } from '@/model/db/repositories/Types_Repository'
import { Versions_Repository } from '@/model/db/repositories/Versions_Repository'
import { Views_Repository } from '@/model/db/repositories/Views_Repository'
import { Vocabs_Repository } from '@/model/db/repositories/Vocabs_Repository'
import { I18nBundles_Repository } from '@/model/db/repositories/I18nBundles_Repository'
import { Workspaces_Repository } from '@/model/db/repositories/Workspaces_Repository'

const WORKSPACE_SCOPED_PAYLOAD_COLLECTIONS = new Set([
  'actions',
  'auth-profiles',
  'behavior-bindings',
  'components',
  'component-sfcs',
  'compositions',
  'stores',
  'mocks',
  'converters',
  'data-views',
  'environments',
  'filters',
  'folders',
  'i18n-bundles',
  'integrations',
  'navigations',
  'page-templates',
  'pages',
  'parameters',
  'policies',
  'presentation-bindings',
  'projects',
  'queries',
  'styles',
  'tenants',
  'types',
  'versions',
  'views',
  'vocabs',
])

function extractPayloadCollectionFromUrl(url: unknown): string | null {
  const text = String(url ?? '').trim()
  if (!text)
    return null

  const pathname = text
    .replace(/^https?:\/\/[^/]+/i, '')
    .split('?')[0]
    .replace(/^\/+/, '')

  return pathname.split('/')[0] || null
}

function isPlainPayloadBody(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function hasWorkspaceValue(data: Record<string, unknown>): boolean {
  const value = data.workspace
  if (value == null)
    return false
  if (typeof value === 'string')
    return value.trim().length > 0

  return true
}

function shouldInjectWorkspace(
  method: unknown,
  url: unknown,
  data: unknown,
): data is Record<string, unknown> {
  const normalizedMethod = String(method ?? 'get').toLowerCase()
  if (normalizedMethod !== 'post' && normalizedMethod !== 'patch')
    return false
  if (!isPlainPayloadBody(data) || hasWorkspaceValue(data))
    return false

  const collection = extractPayloadCollectionFromUrl(url)
  return collection != null && WORKSPACE_SCOPED_PAYLOAD_COLLECTIONS.has(collection)
}

function shouldOverridePayloadDocumentLock(method: unknown): boolean {
  const normalizedMethod = String(method ?? '').trim().toLowerCase()
  return normalizedMethod === 'patch' || normalizedMethod === 'delete'
}

/** Связь в сущности храним по id связанной сущности (не identity). */
function relationToId(v: any): string | number | null | undefined {
  if (v == null)
    return v ?? null
  if (typeof v === 'object') {
    const id = (v as any).id
    if (id != null)
      return id
    const nested = (v as any).value
    if (nested != null)
      return relationToId(nested)
    return null
  }
  return v
}

/** Числовой id relation (в т.ч. из resolved-объекта/вложенного value). */
function relationToNumericId(v: any): number | null {
  const raw = relationToId(v)
  if (raw == null)
    return null
  if (typeof raw === 'number')
    return Number.isFinite(raw) ? raw : null
  const text = String(raw).trim()
  if (!text)
    return null
  const id = Number(text)
  return Number.isFinite(id) ? id : null
}

function relationToNumericIds(v: any): number[] {
  const source = Array.isArray(v) ? v : (v != null ? [v] : [])
  const out: number[] = []
  for (const item of source) {
    const id = relationToNumericId(item)
    if (id != null)
      out.push(id)
  }
  return Array.from(new Set(out))
}

function relationToIdentity(v: any): string | null {
  if (v == null)
    return null
  if (typeof v === 'object') {
    const identity = (v as any).identity ?? (v as any).name
    if (identity != null) {
      const text = String(identity).trim()
      if (text)
        return text
    }
    const nested = (v as any).value
    if (nested != null)
      return relationToIdentity(nested)
    return null
  }
  const text = String(v).trim()
  return text || null
}

function normalizeActionField(
  raw: any,
  fallbackName: string,
): { name: string, type: string, isArray: boolean, optional: boolean } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return null

  const rawType = relationToIdentity(raw.type) ?? relationToId(raw.type)
  if (rawType == null)
    return null

  const type = String(rawType).trim()
  if (!type)
    return null

  return {
    name: String(raw.name ?? '').trim() || fallbackName,
    type,
    isArray: raw.isArray === true,
    optional: raw.optional === true,
  }
}

function toPayloadActionField(raw: any): { type: number | string | null, isArray: boolean, optional: boolean } | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return null

  const rawType = relationToId(raw.type) ?? relationToIdentity(raw.type)
  if (rawType == null)
    return null

  const typeText = String(rawType).trim()
  if (!typeText)
    return null

  const resolvedType = Endge.domain.getType(rawType as string | number)?.id ?? rawType

  return {
    type: resolvedType,
    isArray: raw.isArray === true,
    optional: raw.optional === true,
  }
}

/** Оставляет только targets, поддержанные SFC-моделью v1. */
function normalizeComponentSFCTargets(raw: unknown): Array<'dom' | 'canvas'> {
  if (!Array.isArray(raw))
    return ['dom', 'canvas']

  const targets = raw.filter((target): target is 'dom' | 'canvas' => target === 'dom' || target === 'canvas')
  return targets.length ? Array.from(new Set(targets)) : ['dom', 'canvas']
}

/** Возвращает root-папку раздела "Компоненты" для SFC-документов. */
async function resolveDefaultComponentFolder(repos: RepositoriesBag): Promise<number | string | null> {
  const rootFolder = await repos.folders.findByIdentity('root-components')
  return rootFolder?.id ?? null
}

/** Возвращает root-папку раздела по identity. */
async function resolveDefaultFolderByIdentity(
  repos: RepositoriesBag,
  identity: string,
): Promise<number | string | null> {
  const rootFolder = await repos.folders.findByIdentity(identity)
  return rootFolder?.id ?? null
}

function normalizeFlowDefinition(rawDefinition: any): EndgeFlowDefinition {
  if (!rawDefinition || typeof rawDefinition !== 'object' || Array.isArray(rawDefinition)) {
    return {
      version: 1,
      entrypoint: 'flow-entry',
      nodes: [],
      edges: [],
    }
  }

  const flow = rawDefinition as Record<string, unknown>
  const version = Number(flow.version ?? 1) || 1
  const entrypoint = String(flow.entrypoint ?? 'flow-entry').trim() || 'flow-entry'
  const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
  const edges = Array.isArray(flow.edges) ? flow.edges : []
  const normalizedNodes = nodes.map((rawNode) => {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) {
      return rawNode
    }

    const node = { ...(rawNode as Record<string, unknown>) }
    const rawMeta = node.meta
    if (!rawMeta || typeof rawMeta !== 'object' || Array.isArray(rawMeta)) {
      return node
    }

    const meta = { ...(rawMeta as Record<string, unknown>) }
    const actionIdRaw = String(meta.actionId ?? '').trim()
    if (actionIdRaw) {
      const actionIdNumber = Number(actionIdRaw)
      if (Number.isFinite(actionIdNumber)) {
        meta.actionId = actionIdNumber
      }
    }
    node.meta = meta
    return node
  })

  return {
    ...flow,
    version,
    entrypoint,
    nodes: normalizedNodes,
    edges,
  } as EndgeFlowDefinition
}

const ROOT_FOLDER_ENTITY_TYPE_BY_IDENTITY: Record<string, string> = {
  'root-projects': 'projects',
  'root-types': 'types',
  'root-queries': 'queries',
  'root-data-views': 'data-views',
  'root-compositions': 'compositions',
  'root-stores': 'stores',
  'root-mocks': 'mocks',
  'root-components': 'components',
  'root-actions': 'actions',
  'root-parameters': 'parameters',
  'root-filters': 'filters',
  'root-converters': 'converters',
  'root-integrations': 'integrations',
  'root-views': 'views',
  'root-environments': 'environments',
  'root-tenants': 'tenants',
  'root-policies': 'policies',
  'root-styles': 'styles',
  'root-page-templates': 'page-templates',
  'root-pages': 'pages',
  'root-navigations': 'navigations',
  'root-vocabs': 'vocabs',
  'root-i18n-bundles': 'i18n-bundles',
  'root-auth-profiles': 'auth-profiles',
  'root-behavior-bindings': 'behavior-bindings',
  'root-presentation-bindings': 'presentation-bindings',
}

/**
 * EndgeSchemaStorage:
 *  - держит соединение с Payload
 *  - инициализирует репозитории
 *  - ведёт health / ошибки
 *  - умеет выгружать все коллекции в schema-dump (exportAll)
 */
export class EndgeSchemaStorage extends EndgeModule {
  public isFirstCheck = true
  private _loadedSource: EndgeSchemaDump | null = null

  public payloadBaseAPI!: string
  public payloadSecret!: string

  /** Жив ли вообще Payload (получился ли клиент и ответил ли пинг). */
  public isPayloadAvailable = false

  /** Все ли коллекции успешно отпинговались. */
  public areCollectionsAvailable = false

  /** Внутренний axios-клиент Payload. */
  private api!: AxiosInstance

  private _payloadWorkspaceIdCache: { identity: string, id: string | number } | null = null
  private _payloadWorkspaceIdPromise: Promise<string | number> | null = null

  /** Список ошибок последней проверки (глобальный). */
  private _errors: EndgeSchemaError[] = []

  /**
   * Возвращает накопленные ошибки schema/payload слоя.
   */
  public get ERRORS(): readonly EndgeSchemaError[] {
    return this._errors
  }

  /** Подключённые репозитории (после configurePayload/refresh). */
  public repositories: RepositoriesBag | null = null

  /**
   * По каждой коллекции:
   *  - ok: успешно ли прошёл пинг
   *  - errors: список ошибок, относящихся именно к этой коллекции
   *
   * Ключ - это id коллекции, например: "projects", "types", "queries", ...
   */
  public collectionsInfo: Record<
    string,
    { ok: boolean, errors: EndgeSchemaError[] }
  > = {}

  /**
   * Список коллекций, которые считаем «репозиториями схем».
   * Если какую-то коллекцию пока не используешь - просто удали/добавь.
   */
  public collectionsToCheck: string[] = [
    'projects',
    'folders',
    'types',
    'components',
    'component-sfcs',
    'actions',
    'queries',
    'data-views',
    'compositions',
    'stores',
    'mocks',
    'parameters',
    'filters',
    'converters',
    'integrations',
    'views',
    'page-templates',
    'pages',
    'navigations',
    'versions',
    'environments',
    'tenants',
    'behavior-bindings',
    'presentation-bindings',
    'policies',
    'styles',
    'vocabs',
    'i18n-bundles',
    'auth-profiles',
  ]

  /**
   * Возвращает совокупное состояние здоровья Payload/schema слоя.
   */
  public get isHealthy(): boolean {
    return (
      this.isPayloadAvailable
      && this.areCollectionsAvailable
      && this._errors.length === 0
    )
  }

  /**
   * Показывает, есть ли ошибки подключения, health-check или доступности коллекций.
   */
  public get hasErrors(): boolean {
    return (
      !this.isPayloadAvailable
      || !this.areCollectionsAvailable
      || this._errors.length > 0
    )
  }

  /**
   * Полная настройка Payload:
   *  - сохраняем baseURL / secret
   *  - создаём axios-клиент
   *  - вызываем refresh()
   *  - запускаем периодический refresh()
   */
  public async configurePayload(opts: {
    payloadBaseAPI: string
    payloadSecret: string
  }): Promise<void> {
    this.payloadBaseAPI = opts.payloadBaseAPI
    this.payloadSecret = opts.payloadSecret

    // сбрасываем старое состояние
    this._errors = []
    this.isPayloadAvailable = false
    this.areCollectionsAvailable = false
    this.repositories = null
    this.collectionsInfo = {}
    this._payloadWorkspaceIdCache = null
    this._payloadWorkspaceIdPromise = null

    // 0) проверка настроек
    if (!this.payloadBaseAPI || !this.payloadSecret) {
      this.pushError({
        kind: 'PAYLOAD_NOT_CONFIGURED',
        message:
          'Payload не сконфигурирован: baseURL или secret не заданы (см. configurePayload-параметры).',
        details: {
          baseURLPresent: !!this.payloadBaseAPI,
          secretPresent: !!this.payloadSecret,
        },
      })
      await this.refresh()
      return
    }

    // 1) создаём клиент
    this.api = axios.create({
      baseURL: this.payloadBaseAPI,
      headers: {
        Authorization: `Bearer ${this.payloadSecret}`,
      },
    })
    this.installWorkspaceRequestInterceptor()

    // первый запуск проверки
    await this.refresh()

    // и периодический рефреш
    // setInterval(async () => {
    //   await this.refresh()
    // }, 100000)
  }

  /**
   * На фазе `setup` настраивает Payload client, если boot идет через payload-provider.
   */
  public override async setup(ctx: EndgeBootContext): Promise<void> {
    if (ctx.dataProvider !== 'payload')
      return

    await this.configurePayload({
      payloadBaseAPI: ctx.payload?.baseAPI ?? '',
      payloadSecret: ctx.payload?.secret ?? '',
    })
  }

  /**
   * На фазе `load` выгружает schema dump из Payload и сохраняет его внутри модуля.
   */
  public override async load(ctx: EndgeBootContext): Promise<void> {
    if (ctx.dataProvider !== 'payload')
      return

    this._loadedSource = await this.exportAll()
  }

  /**
   * Возвращает dump, загруженный на фазе `load`.
   */
  public getLoadedSource(): EndgeSchemaDump | null {
    return this._loadedSource
  }

  /**
   * Очищает загруженный schema dump при reset federation.
   */
  public override reset(): void {
    this._loadedSource = null
  }

  /** Устанавливает interceptor для lock override и workspace relation. */
  private installWorkspaceRequestInterceptor(): void {
    this.api.interceptors.request.use(async (config) => {
      if (shouldOverridePayloadDocumentLock(config.method)) {
        config.params = {
          ...(config.params ?? {}),
          overrideLock: 'true',
        }
      }

      if (!shouldInjectWorkspace(config.method, config.url, config.data))
        return config

      config.data.workspace = await this.resolvePayloadWorkspaceId()
      return config
    })
  }

  /** Возвращает identity активного workspace. */
  private getCurrentWorkspaceIdentity(): string {
    const fromContext = Endge.context.getCurrentWorkspace?.()
    const fromWorkspace = Endge.workspace.isLoaded ? Endge.workspace.current.identity : null
    const identity = String(fromContext || fromWorkspace || '').trim()

    if (!identity)
      throw new Error('[EndgeSchemaStorage] Active workspace has not been loaded from Payload')

    return identity
  }

  /** Разрешает и кеширует Payload id активного workspace. */
  private async resolvePayloadWorkspaceId(): Promise<string | number> {
    const identity = this.getCurrentWorkspaceIdentity()
    if (this._payloadWorkspaceIdCache?.identity === identity)
      return this._payloadWorkspaceIdCache.id

    if (!this._payloadWorkspaceIdPromise) {
      this._payloadWorkspaceIdPromise = this.fetchPayloadWorkspaceId(identity)
        .finally(() => {
          this._payloadWorkspaceIdPromise = null
        })
    }

    const id = await this._payloadWorkspaceIdPromise
    this._payloadWorkspaceIdCache = { identity, id }
    return id
  }

  /** Загружает Payload id workspace по identity. */
  private async fetchPayloadWorkspaceId(identity: string): Promise<string | number> {
    const doc = await this.repositories?.workspaces?.findByIdentity(identity)
      ?? await this.fetchPayloadWorkspaceByIdentity(identity)

    if (!doc?.id) {
      throw new Error(
        `[EndgeSchemaStorage] Workspace "${identity}" не найден в Payload. Сначала создай или засиди workspace.`,
      )
    }

    return doc.id
  }

  /** Ищет workspace через совместимые Payload collection endpoints. */
  private async fetchPayloadWorkspaceByIdentity(identity: string): Promise<any | null> {
    const params = {
      limit: 1,
      'where[identity][equals]': identity,
    }

    try {
      const r = await this.api.get('/workspaces', { params })
      return r.data.docs?.[0] ?? null
    }
    catch {
      const r = await this.api.get('/workspace', { params })
      return r.data.docs?.[0] ?? null
    }
  }

  /** Возвращает или создаёт корневую Payload folder. */
  private async ensurePayloadRootFolder(params: {
    identity: string
    displayName: string
    entityType: string
  }): Promise<string | number | null> {
    const repos = this.repositories
    if (!repos)
      return null

    const existing = await repos.folders.findByIdentity(params.identity)
    if (existing?.id != null)
      return existing.id

    const created = await repos.folders.create({
      identity: params.identity,
      displayName: params.displayName,
      entityType: params.entityType,
    })

    return created?.id ?? null
  }

  /**
   * Завершает health-check итерацию и уведомляет подписчиков.
   */
  public logResult(): void {
    this.isFirstCheck = false
    this.notify()
  }

  /**
   * Обновление health + инициализация репозиториев.
   */
  public async refresh(): Promise<void> {
    // очистим per-collection статусы перед новой проверкой
    this._errors = []
    this.collectionsInfo = {}

    // 2) создаём репозитории (обёртки над axios)
    if (this.api) {
      this.repositories = {
        projects: new Projects_Repository(this.api),
        types: new Types_Repository(this.api),
        queries: new Queries_Repository(this.api),
        dataViews: new DataViews_Repository(this.api),
        compositions: new Compositions_Repository(this.api),
        stores: new Stores_Repository(this.api),
        mocks: new Mocks_Repository(this.api),
        folders: new Folders_Repository(this.api),
        components: new Components_Repository(this.api),
        componentSFCs: new ComponentSFCs_Repository(this.api),
        actions: new Actions_Repository(this.api),
        parameters: new Parameters_Repository(this.api),
        filters: new Filters_Repository(this.api),
        converters: new Converters_Repository(this.api),
        integrations: new Integrations_Repository(this.api),
        views: new Views_Repository(this.api),
        versions: new Versions_Repository(this.api),
        environments: new Environments_Repository(this.api),
        tenants: new Tenants_Repository(this.api),
        behaviorBindings: new BehaviorBindings_Repository(this.api),
        presentationBindings: new PresentationBindings_Repository(this.api),
        policies: new Policies_Repository(this.api),
        styles: new Styles_Repository(this.api),
        vocabs: new Vocabs_Repository(this.api),
        i18nBundles: new I18nBundles_Repository(this.api),
        authProfiles: new AuthProfiles_Repository(this.api),
        pageTemplates: new PageTemplates_Repository(this.api),
        pages: new Pages_Repository(this.api),
        navigations: new Navigations_Repository(this.api),
        workspaces: new Workspaces_Repository(this.api),
      }
    }

    // 3) пингуем Payload одним запросом (limit 1) для быстрого старта
    try {
      await this.api.get('/projects', { params: { limit: 1 } })
      this.isPayloadAvailable = true
      this.areCollectionsAvailable = true
    }
    catch (e) {
      const err = this.pushError({
        kind: 'PAYLOAD_PING_FAILED',
        message: 'Payload не отвечает или вернул ошибку при пинге /projects.',
        details: this.normalizeError(e),
      })

      const key = 'projects'
      const prev = this.collectionsInfo[key] || { ok: false, errors: [] }
      this.collectionsInfo[key] = {
        ok: false,
        errors: [...prev.errors, err],
      }

      this.logResult()
      return
    }

    // 4) пинг каждой коллекции отключён - для быстродействия проверяем только один запрос (шаг 3)
    // for (const collection of this.collectionsToCheck) {
    //   try {
    //     await this.api.get(`/${collection}`, { params: { limit: 1 } })
    //     const prev = this.collectionsInfo[collection] || { ok: true, errors: [] }
    //     this.collectionsInfo[collection] = { ok: true, errors: prev.errors }
    //   } catch (e) {
    //     allOk = false
    //     const err = this.pushError({
    //       kind: 'COLLECTION_UNREACHABLE',
    //       collection,
    //       message: `Коллекция "${collection}" недоступна (ошибка REST-запроса).`,
    //       details: this.normalizeError(e),
    //     })
    //     const prev = this.collectionsInfo[collection] || { ok: false, errors: [] }
    //     this.collectionsInfo[collection] = { ok: false, errors: [...prev.errors, err] }
    //   }
    // }
    // this.areCollectionsAvailable = allOk

    this.logResult()
  }

  /**
   * Загружает список версий (без data) в Endge.domain.
   */
  public async loadVersionsList(): Promise<void> {
    if (!this.repositories)
      return
    const rows = await this.repositories.versions.findAll()
    const list = rows.map((doc: any) => RVersion.fromPayload(doc))
    Endge.domain.setVersions(list)
  }

  /**
   * Выгружает ВСЕ данные по всем коллекциям и приводит их
   * к «чистому» schema-формату (без storage-мета).
   */
  public async exportAll(): Promise<EndgeSchemaDump> {
    if (!this.repositories) {
      throw new Error(
        '[EndgeSchemaStorage.exportAll] Репозитории ещё не инициализированы. Сначала вызови init().',
      )
    }

    const dump: EndgeSchemaDump = {
      workspaces: [],
      projects: [],
      folders: [],
      types: [],
      queries: [],
      dataViews: [],
      compositions: [],
      stores: [],
      mocks: [],
      components: [],
      componentSFCs: [],
      actions: [],
      converters: [],
      integrations: [],
      views: [],
      vocabs: [],
      i18nBundles: [],
      authProfiles: [],
      parameters: [],
      filters: [],
      versions: [],
      environments: [],
      tenants: [],
      behaviorBindings: [],
      presentationBindings: [],
      policies: [],
      styles: [],
      pageTemplates: [],
      pages: [],
      navigations: [],
    }

    const normalizePolicy = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description,
        folderId: relationToId(raw.folder) ?? null,
      }
    }

    const normalizeEnvironment = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
      }
    }

    const normalizeTenant = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        code: raw.code ?? raw.identity ?? '',
        description: raw.description ?? null,
        folderId: relationToId(raw.folder) ?? null,
      }
    }

    const normalizeWorkspace = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.name ?? raw.displayName,
        displayName: raw.displayName ?? raw.name,
        vars: raw.vars ?? [],
        sse: raw.sse ?? undefined,
        locales: raw.locales ?? raw.availableLocales ?? [],
        defaultLocale: raw.defaultLocale ?? raw.default_locale,
        fallbackLocale: raw.fallbackLocale ?? raw.fallback_locale,
        defaultAuthProfileIdentity: raw.defaultAuthProfileIdentity ?? raw.default_auth_profile_identity ?? null,
        sfcAdapterIds: raw.sfcAdapterIds ?? raw.sfc_adapter_ids ?? [],
        defaultSfcAdapterId: raw.defaultSfcAdapterId ?? raw.default_sfc_adapter_id,
      }
    }

    const normalizeBehaviorBinding = (raw: any) => {
      const modeText = String(raw.mode ?? 'replace').trim().toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable' ? modeText : 'replace'
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        projectId: relationToNumericId(raw.projectId) ?? null,
        ownerType: String(raw.ownerType ?? '').trim(),
        ownerId: relationToNumericId(raw.ownerId) ?? null,
        targetType: String(raw.targetType ?? '').trim(),
        targetId: relationToNumericId(raw.targetId) ?? null,
        eventName: String(raw.eventName ?? '').trim(),
        scriptRef: String(raw.scriptRef ?? '').trim(),
        mode,
        priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
        isEnabled: raw.isEnabled !== false,
        environmentId: relationToNumericId(raw.environmentId) ?? null,
        isInherited: raw.isInherited === true,
        originBindingId: relationToNumericId(raw.originBindingId) ?? null,
        folderId: relationToId(raw.folder) ?? null,
      }
    }

    const normalizePresentationBinding = (raw: any) => {
      const modeText = String(raw.mode ?? 'replace').trim().toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable' ? modeText : 'replace'
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        projectId: relationToNumericId(raw.projectId) ?? null,
        ownerType: String(raw.ownerType ?? '').trim(),
        ownerId: relationToNumericId(raw.ownerId) ?? null,
        targetType: String(raw.targetType ?? '').trim(),
        targetId: relationToNumericId(raw.targetId) ?? null,
        role: String(raw.role ?? '').trim(),
        rendererRef: String(raw.rendererRef ?? '').trim(),
        when: raw.when == null ? null : String(raw.when).trim(),
        mode,
        priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
        isEnabled: raw.isEnabled !== false,
        environmentId: relationToNumericId(raw.environmentId) ?? null,
        isInherited: raw.isInherited === true,
        originBindingId: relationToNumericId(raw.originBindingId) ?? null,
        folderId: relationToId(raw.folder) ?? null,
      }
    }

    const normalizeStyle = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        styles: (raw.styles && typeof raw.styles === 'object' && !Array.isArray(raw.styles)) ? raw.styles : {},
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
        inherited: raw.inherited === true,
        isSystem: raw.isSystem === true,
      }
    }

    const normalizePageTemplate = (raw: any) => {
      const preview = raw.preview && typeof raw.preview === 'object' && Array.isArray(raw.preview.rows)
        ? {
            rows: raw.preview.rows,
            ...(Array.isArray(raw.preview.rowHeights) && { rowHeights: raw.preview.rowHeights }),
          }
        : null
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        areas: Array.isArray(raw.areas)
          ? raw.areas.map((a: any) => ({
              identity: a?.identity ?? '',
              title: a?.title ?? null,
              description: a?.description ?? null,
            }))
          : [],
        preview,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }

    const normalizePage = (raw: any) => {
      const templateId
        = relationToNumericId(raw.template)
          ?? relationToNumericId(raw.templateId)
          ?? relationToNumericId(raw.templateIdentity)
          ?? null
      const controllerId
        = relationToNumericId(raw.controller)
          ?? relationToNumericId(raw.controllerId)
          ?? relationToNumericId(raw.controllerIdentity)
          ?? null

      const areas = Array.isArray(raw.areas) ? raw.areas : []

      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        routeName: raw.routeName ?? null,
        routePath: raw.routePath ?? null,
        templateId,
        controllerId,
        enabled: raw.enabled !== false,
        areas: areas.map((a: any) => ({
          slotId: a?.slotId ?? '',
          blocks: Array.isArray(a?.blocks)
            ? a.blocks.map((b: any) => {
                const ent = b?.entity
                const relationTo = typeof ent === 'object' && ent != null ? (ent.relationTo ?? ent.collection) : null
                const value = typeof ent === 'object' && ent != null ? ent.value : ent
                const entityType = relationTo === 'filters' ? 'filter' : (relationTo === 'components' ? 'component' : (relationTo ? String(relationTo) : null))
                const entityId = typeof value === 'number' && Number.isFinite(value) ? value : (typeof value === 'object' && value != null && value.id != null ? Number(value.id) : null)
                const entityIdentity = typeof value === 'object' && value != null
                  ? (value.identity ?? (value.id != null ? String(value.id) : null))
                  : (typeof value === 'string' || typeof value === 'number' ? String(value) : null)
                return {
                  key: b?.key ?? '',
                  entityType: entityType ?? null,
                  entityId: entityId != null && Number.isFinite(entityId) ? entityId : null,
                  entityIdentity: entityIdentity ?? null,
                  titleOverride: b?.titleOverride ?? null,
                  visibleWhen: b?.visibleWhen ?? null,
                  props: (b?.props && typeof b.props === 'object' && !Array.isArray(b.props)) ? b.props : null,
                }
              })
            : [],
        })),
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }

    const normalizeVersion = (raw: any) => ({
      id: raw.id,
      identity: raw.identity,
      description: raw.description,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
      project: relationToId(raw.project) ?? null,
    })

    const normalizeSchemaEntity = (raw: any) => {
      const schema = raw.schema ?? {}

      const id
        = schema.id ?? raw.id

      const name
        = schema.name
          ?? raw.displayName

      const identity = schema.identity ?? raw.identity

      return {
        ...schema,
        id,
        identity,
        name,
        folderId: relationToId(raw.folder) ?? schema.folderId ?? schema.folder ?? null,
        project: relationToId(raw.project) ?? null,
        isPrimitive: schema.isPrimitive === true || raw.isPrimitive === true,
        isSystem: raw.isSystem === true,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : (schema.meta ?? {}),
      }
    }

    /** Компонент из flat-полей payload (без использования raw.schema). */
    const normalizeComponentFromPayload = (raw: any) => {
      const id = raw.id
      const identity = raw.identity ?? ''
      const name = raw.displayName
      const type = raw.componentType ?? 'component-dsl'

      const inputFields = Array.isArray(raw.inputFields) ? raw.inputFields : []
      const inputs: Record<string, any> = {}
      for (const f of inputFields) {
        const key = f?.name
        if (!key)
          continue
        const params = Array.isArray(f.params) ? f.params : []
        inputs[key] = {
          name: key,
          type: f?.type ?? '',
          isArray: f?.isArray === true,
          optional: f?.optional === true,
          params: params.map((p: any) => ({ name: p?.name ?? '', type: p?.type ?? '' })),
        }
      }

      const runtimeFilters = Array.isArray(raw.runtimeFilters)
        ? raw.runtimeFilters.map((x: any) => (typeof x === 'object' && x?.value != null ? x.value : String(x)))
        : []

      const base: Record<string, any> = {
        id,
        identity,
        name,
        type,
        inputs,
        runtimeFilters,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
        inherited: raw.inherited === true,
      }

      if (type === 'component-dsl') {
        return { ...base, jsxScript: raw.jsxScript ?? '' }
      }

      if (type === 'component-table') {
        const bindingsKeys: Record<string, { pk: string, fk: string }> = {}
        const keysArr = Array.isArray(raw.bindings?.keys) ? raw.bindings.keys : []
        for (const k of keysArr) {
          const varName = k?.varName
          if (!varName)
            continue
          bindingsKeys[varName] = {
            pk: typeof k?.pk === 'string' ? k.pk : '',
            fk: typeof k?.fk === 'string' ? k.fk : '',
          }
        }

        const columns = (Array.isArray(raw.columns) ? raw.columns : []).map((col: any) => {
          const src = (
            col
            && typeof col === 'object'
            && col.value
            && col.id === undefined
            && col.title === undefined
          )
            ? col.value
            : col
          const dataPaths: Record<string, string> = {}
          if (Array.isArray(src?.dataPaths)) {
            for (const p of src.dataPaths) {
              const key = p?.key
              if (key != null)
                dataPaths[key] = p?.path ?? ''
            }
          }
          else if (src?.dataPaths && typeof src.dataPaths === 'object') {
            for (const [k, v] of Object.entries(src.dataPaths))
              dataPaths[k] = String(v ?? '')
          }

          const dataConverters: Record<string, string> = {}
          if (Array.isArray(src?.dataConverters)) {
            for (const c of src.dataConverters) {
              const dk = c?.dataPathKey
              if (dk == null)
                continue
              const conv = c?.converter
              const identity = typeof conv === 'object' && conv?.identity != null
                ? conv.identity
                : (typeof conv === 'string' ? conv : (conv != null ? String(conv) : ''))
              if (identity)
                dataConverters[dk] = (dataConverters[dk] ? `${dataConverters[dk]},` : '') + identity
            }
          }
          else if (src?.dataConverters && typeof src.dataConverters === 'object') {
            for (const [k, v] of Object.entries(src.dataConverters))
              dataConverters[k] = String(v ?? '')
          }

          const reports: Record<string, any> = {}
          if (Array.isArray(src?.reports)) {
            for (const r of src.reports) {
              const key = r?.key
              if (key == null)
                continue
              reports[key] = {
                enabled: r?.enabled !== false,
                formatter: (r?.formatterType || r?.formatterFormat)
                  ? { type: r?.formatterType, format: r?.formatterFormat }
                  : undefined,
              }
            }
          }
          else if (src?.reports && typeof src.reports === 'object') {
            Object.assign(reports, src.reports)
          }

          const componentId
            = relationToNumericId(src?.component)
              ?? relationToNumericId(src?.componentId)
              ?? null

          return {
            id: src?.id,
            isActive: src?.isActive !== false,
            title: src?.title ?? '',
            type: src?.type ?? 'component',
            width: src?.width ?? 150,
            pin: src?.pin ?? 'none',
            sort: (src?.sort?.by || src?.sort?.type)
              ? { by: src.sort?.by, type: src.sort?.type }
              : null,
            dataPaths,
            dataConverters,
            reports: Object.keys(reports).length ? reports : null,
            eventHandlers: (Array.isArray(src?.eventHandlers) ? src.eventHandlers : []).map((h: any) => ({
              event: h?.event ?? '',
              actionId: h?.actionId != null ? String(h.actionId) : null,
            })),
            componentId,
            template: src?.template ?? null,
          }
        })

        return {
          ...base,
          sourceIndex: raw.sourceIndex ?? '',
          rowSize: raw.rowSize ?? 40,
          bindings: { keys: bindingsKeys },
          columns,
        }
      }

      return base
    }

    /** SFC-компонент из отдельной flat-коллекции payload. */
    const normalizeComponentSFC = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity ?? '',
        name: raw.displayName ?? raw.identity ?? '',
        displayName: raw.displayName ?? raw.identity ?? '',
        description: raw.description ?? null,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        kind: 'component-sfc',
        type: ComponentType.SFC,
        sourceKind: 'component-sfc',
        source: typeof raw.source === 'string' ? raw.source : '',
        supportedTargets: normalizeComponentSFCTargets(raw.supportedTargets),
        modelVersion: Number(raw.modelVersion ?? 1),
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
        active: raw.active ?? true,
        deletedAt: raw.deletedAt ?? null,
        author: raw.author ?? null,
        inherited: raw.inherited === true,
      }
    }

    const normalizeQuery = (raw: any) => {
      const folderId = relationToId(raw.folder)
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        type: QueryType.REST,
        source: typeof raw.source === 'string' ? raw.source : '',
        sourceVersion: Number(raw.sourceVersion ?? 2) || 2,
        folderId,
        project: relationToId(raw.project) ?? null,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
        inherited: raw.inherited === true,
      }
    }

    const normalizeDataView = (raw: any) => dataViewPayloadDocToPlain(raw)
    const normalizeComposition = (raw: any) => compositionPayloadDocToPlain(raw)
    const normalizeStore = (raw: any) => storePayloadDocToPlain(raw)
    const normalizeMock = (raw: any) => mockPayloadDocToPlain(raw)

    const normalizeFolder = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        entityType: typeof raw.entityType === 'string' && raw.entityType.trim() ? raw.entityType.trim() : null,
        parent: relationToId(raw.parent) ?? null,
        folderId: null,
        project: relationToId(raw.project) ?? null,
        isSystem: raw.isSystem === true,
      }
    }

    const normalizeProject = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        slug: raw.slug ?? null,
        order: raw.order != null ? Number(raw.order) : null,
        navigationId: relationToId(raw.navigation) ?? null,
        allowedEnvironmentIds: relationToNumericIds(raw.allowedEnvironments ?? raw.allowedEnvironmentIds ?? []),
      }
    }

    const normalizeVocabs = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        mode: raw.mode === 'internal' ? 'internal' : 'external_payload',
        baseApiUrl: raw.baseApiUrl ?? null,
        collectionSlug: raw.collectionSlug ?? null,
        authMode: raw.authMode ?? 'inherit',
        authProfileIdentity: raw.authProfileIdentity ?? null,
        folderId: relationToId(raw.folder) ?? null,
        active: raw.active !== false,
        deletedAt: raw.deletedAt ?? null,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }

    const normalizeAuthProfile = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        adapterId: raw.adapterId ?? 'manual_token',
        config: (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) ? raw.config : {},
        credentialRefs: (raw.credentialRefs && typeof raw.credentialRefs === 'object' && !Array.isArray(raw.credentialRefs)) ? raw.credentialRefs : {},
        persist: raw.persist ?? 'localStorage',
        folderId: relationToId(raw.folder) ?? null,
        active: raw.active !== false,
        deletedAt: raw.deletedAt ?? null,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }

    const normalizeI18nBundle = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        locales: (raw.locales && typeof raw.locales === 'object' && !Array.isArray(raw.locales)) ? raw.locales : {},
        folderId: relationToId(raw.folder) ?? null,
        active: raw.active !== false,
        deletedAt: raw.deletedAt ?? null,
      }
    }

    const normalizeParameters = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        author: raw.author ?? null,
        active: raw.active ?? true,
        deletedAt: raw.deletedAt ?? null,
        fields: raw.fields ?? [],
        runtimeFilters: raw.runtimeFilters ?? [],
      }
    }

    const normalizeConverterIdentities = (arr: any, legacySingle?: string): string[] => {
      if (Array.isArray(arr))
        return arr.map((c: any) => (typeof c === 'string' ? c : c?.identity)).filter(Boolean)
      if (legacySingle)
        return [legacySingle]
      return []
    }

    const normalizeFilters = (raw: any) => {
      const fields = (raw.fields ?? []).map((f: any) => ({
        ...f,
        active: f.active !== false,
        multiple: f.multiple !== false,
        converterIdentities: normalizeConverterIdentities(f.converterIdentities, f.converterIdentity),
        converterIdentity: undefined,
      }))
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        author: raw.author ?? null,
        active: raw.active ?? true,
        deletedAt: raw.deletedAt ?? null,
        fields,
        source: String(raw.source ?? ''),
        sourceVersion: Number(raw.sourceVersion ?? 1) || 1,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
        inherited: raw.inherited === true,
      }
    }

    const normalizeConverter = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
      }
    }

    const normalizeIntegration = (raw: any) => {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        isSystem: raw.isSystem === true,
        project: relationToId(raw.project) ?? null,
      }
    }

    const normalizeView = (raw: any) => {
      const componentId = relationToNumericId(raw.component) ?? relationToNumericId(raw.componentId)
      const filterId = relationToNumericId(raw.filter) ?? relationToNumericId(raw.filterId)
      const queryId = relationToNumericId(raw.query) ?? relationToNumericId(raw.queryId)

      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        componentId: componentId ?? null,
        filterId: filterId ?? null,
        queryId: queryId ?? null,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }

    // ==== ОБЩИЙ ЛОАДЕР С ОБРАБОТКОЙ ОШИБОК ====

    const load = async (
      key: keyof EndgeSchemaDump,
      fn: () => Promise<any[]>,
    ) => {
      try {
        dump[key] = await fn()
      }
      catch (e) {
        const err = this.pushError({
          kind: 'COLLECTION_UNREACHABLE',
          collection: key,
          message: `Не удалось выгрузить данные коллекции "${String(key)}".`,
          details: this.normalizeError(e),
        })

        const prev = this.collectionsInfo[String(key)] || {
          ok: false,
          errors: [],
        }
        this.collectionsInfo[String(key)] = {
          ok: false,
          errors: [...prev.errors, err],
        }
      }
    }

    const normalizeAction = (raw: any) => {
      const id = raw.id
      const identity = raw.identity
      const displayName = raw.displayName

      return {
        id,
        identity,
        name: displayName,
        displayName,
        description: raw.description ?? null,

        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        definition: normalizeFlowDefinition(raw.definition),
        input: normalizeActionField(raw.input, 'input'),
        output: normalizeActionField(raw.output, 'output'),
      }
    }

    // ==== ПАРАЛЛЕЛЬНАЯ ВЫГРУЗКА + НОРМАЛИЗАЦИЯ ====

    await Promise.all([
      load('folders', async () => {
        const rows = await this.repositories!.folders.findAll()
        return rows.map(normalizeFolder)
      }),

      load('projects', async () => {
        const rows = await this.repositories!.projects.findAll()
        return rows.map(normalizeProject)
      }),

      load('workspaces', async () => {
        const rows = await this.repositories!.workspaces!.findAll()
        return rows.map(normalizeWorkspace)
      }),

      load('types', async () => {
        const rows = await this.repositories!.types.findAll()
        return rows.map(normalizeSchemaEntity)
      }),

      load('queries', async () => {
        const rows = await this.repositories!.queries.findAll()
        return rows.map(normalizeQuery)
      }),

      load('dataViews', async () => {
        const rows = await this.repositories!.dataViews.findAll()
        return rows.map(normalizeDataView)
      }),

      load('compositions', async () => {
        const rows = await this.repositories!.compositions.findAll()
        return rows.map(normalizeComposition)
      }),

      load('stores', async () => {
        const rows = await this.repositories!.stores.findAll()
        return rows.map(normalizeStore)
      }),

      load('mocks', async () => {
        const rows = await this.repositories!.mocks.findAll()
        return rows.map(normalizeMock)
      }),

      load('components', async () => {
        const rows = await this.repositories!.components.findAll()
        return rows.map(normalizeComponentFromPayload)
      }),

      load('componentSFCs', async () => {
        const rows = await this.repositories!.componentSFCs.findAll()
        return rows.map(normalizeComponentSFC)
      }),

      load('actions', async () => {
        const rows = await this.repositories!.actions.findAll()
        return rows.map(normalizeAction)
      }),

      load('vocabs', async () => {
        const rows = await this.repositories!.vocabs.findAll()
        return rows.map(normalizeVocabs)
      }),

      load('authProfiles', async () => {
        const rows = await this.repositories!.authProfiles.findAll()
        return rows.map(normalizeAuthProfile)
      }),

      load('i18nBundles', async () => {
        const rows = await this.repositories!.i18nBundles.findAll()
        return rows.map(normalizeI18nBundle)
      }),

      load('parameters', async () => {
        const rows = await this.repositories!.parameters.findAll()
        return rows.map(normalizeParameters)
      }),

      load('filters', async () => {
        const rows = await this.repositories!.filters.findAll()
        return rows.map(normalizeFilters)
      }),

      load('converters', async () => {
        const rows = await this.repositories!.converters.findAll()
        return rows.map(normalizeConverter)
      }),

      load('integrations', async () => {
        const rows = await this.repositories!.integrations.findAll()
        return rows.map(normalizeIntegration)
      }),

      load('views', async () => {
        const rows = await this.repositories!.views.findAll()
        return rows.map(normalizeView)
      }),

      load('versions', async () => {
        const rows = await this.repositories!.versions.findAll()
        return rows.map(normalizeVersion)
      }),

      load('environments', async () => {
        const rows = await this.repositories!.environments.findAll()
        return rows.map(normalizeEnvironment)
      }),

      load('tenants', async () => {
        const rows = await this.repositories!.tenants.findAll()
        return rows.map(normalizeTenant)
      }),

      load('behaviorBindings', async () => {
        const rows = await this.repositories!.behaviorBindings.findAll()
        return rows.map(normalizeBehaviorBinding)
      }),

      load('presentationBindings', async () => {
        const rows = await this.repositories!.presentationBindings.findAll()
        return rows.map(normalizePresentationBinding)
      }),

      load('policies', async () => {
        const rows = await this.repositories!.policies.findAll()
        return rows.map(normalizePolicy)
      }),

      load('styles', async () => {
        const rows = await this.repositories!.styles.findAll()
        return rows.map(normalizeStyle)
      }),

      load('pageTemplates', async () => {
        const rows = await this.repositories!.pageTemplates.findAll()
        return rows.map(normalizePageTemplate)
      }),

      load('pages', async () => {
        const rows = await this.repositories!.pages.findAll()
        return rows.map(normalizePage)
      }),

      load('navigations', async () => {
        const rows = await this.repositories!.navigations.findAll()
        return rows.map((raw: any) => ({
          id: raw.id,
          identity: raw.identity ?? '',
          name: raw.displayName ?? raw.identity ?? '',
          description: raw.description ?? null,
          isSystem: raw.isSystem === true,
          folderId: relationToId(raw.folder) ?? null,
          project: relationToId(raw.project) ?? null,
          tree: Array.isArray(raw.tree) ? raw.tree : [],
          meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
        }))
      }),
    ])

    return dump
  }

  /**
   * Возвращает документ из домена по типу и id/identity.
   */
  private getDomainDocumentByType(
    documentType: DomainDocumentType,
    documentIdOrIdentity: string | number,
  ): any | null {
    const domain = Endge.domain
    if (documentType === ComponentType.SFC)
      return domain.getComponentSFC(documentIdOrIdentity)
    if (documentType === ComponentType.Table || documentType === ComponentType.DSL)
      return domain.getComponent(documentIdOrIdentity)
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom)
      return domain.getQuery(documentIdOrIdentity)
    if (documentType === 'data-view')
      return domain.getDataView(documentIdOrIdentity)
    if (documentType === 'composition')
      return domain.getComposition(documentIdOrIdentity)
    if (documentType === 'store')
      return domain.getStore(documentIdOrIdentity)
    if (documentType === 'mock')
      return domain.getMock(documentIdOrIdentity)
    if (documentType === ParameterType.DefaultParameter)
      return domain.getParameter(documentIdOrIdentity)
    if (documentType === FilterType.DefaultFilter)
      return domain.getFilter(documentIdOrIdentity)
    if (documentType === 'type' || documentType === 'primitive')
      return domain.getType(documentIdOrIdentity)
    if (documentType === 'action')
      return domain.getAction(documentIdOrIdentity)
    if (documentType === 'converter')
      return domain.getConverter(documentIdOrIdentity)
    if (documentType === 'integration')
      return domain.getIntegration(documentIdOrIdentity)
    if (documentType === 'view')
      return domain.getView(documentIdOrIdentity)
    if (documentType === 'environment')
      return domain.getEnvironment(documentIdOrIdentity)
    if (documentType === 'tenant')
      return domain.getTenant(documentIdOrIdentity)
    if (documentType === 'behavior-binding')
      return domain.getBehaviorBinding(documentIdOrIdentity)
    if (documentType === 'presentation-binding')
      return domain.getPresentationBinding(documentIdOrIdentity)
    if (documentType === 'policy')
      return domain.getPolicy(documentIdOrIdentity)
    if (documentType === 'style')
      return domain.getStyle(documentIdOrIdentity)
    if (documentType === 'page-template')
      return domain.getPageTemplate(documentIdOrIdentity)
    if (documentType === 'page')
      return domain.getPage(documentIdOrIdentity)
    if (documentType === 'navigation')
      return domain.getNavigation(documentIdOrIdentity)
    if (documentType === 'vocabs')
      return domain.getVocab(documentIdOrIdentity)
    if (documentType === 'auth-profile')
      return domain.getAuthProfile(documentIdOrIdentity)
    if (documentType === 'i18n-bundles')
      return domain.getI18nBundle(documentIdOrIdentity)
    if (documentType === 'project')
      return domain.getProject(documentIdOrIdentity)
    return null
  }

  /**
   * Разрешает identity документа по входному id/identity.
   * Нужен для репозиториев, где основной ключ запроса - identity.
   */
  private resolveDocumentIdentity(
    documentIdOrIdentity: string | number,
    documentType: DomainDocumentType,
  ): string {
    const doc = this.getDomainDocumentByType(documentType, documentIdOrIdentity)
    const identity = (doc as any)?.identity
    if (typeof identity === 'string' && identity.trim().length > 0)
      return identity
    if (identity != null)
      return String(identity)
    return String(documentIdOrIdentity)
  }

  /** Payload id документа из домена (для PATCH без лишнего GET). */
  /**
   * Разрешает Document Payload Id.
   */
  private resolveDocumentPayloadId(
    documentIdOrIdentity: string | number,
    documentType: DomainDocumentType,
  ): number | string | null {
    const doc = this.getDomainDocumentByType(documentType, documentIdOrIdentity)
    const id = (doc as any)?.id
    if (id == null) return null
    if (typeof id === 'number' && Number.isFinite(id)) return id
    if (typeof id === 'string' && id.trim() !== '') return id
    return null
  }

  /**
   * Проверяет is Malformed Payload Document Id.
   */
  private isMalformedPayloadDocumentId(id: unknown): boolean {
    if (id == null)
      return true
    if (typeof id === 'number')
      return !Number.isFinite(id)
    const text = String(id).trim()
    if (!text)
      return true
    const normalized = text.toLowerCase()
    return normalized === 'undefined' || normalized === 'null' || normalized === 'nan'
  }

  /**
   * Внутренний helper модуля: find Payload Document By Identity.
   */
  private async findPayloadDocumentByIdentity(
    documentType: DomainDocumentType,
    identity: string,
  ): Promise<any | null> {
    const repos = this.repositories
    if (!repos)
      return null

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL)
      return repos.components.findByIdentity(identity)
    if (documentType === ComponentType.SFC)
      return repos.componentSFCs.findByIdentity(identity)
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom)
      return repos.queries.findByIdentity(identity)
    if (documentType === 'data-view')
      return repos.dataViews.findByIdentity(identity)
    if (documentType === 'composition')
      return repos.compositions.findByIdentity(identity)
    if (documentType === 'store')
      return repos.stores.findByIdentity(identity)
    if (documentType === 'mock')
      return repos.mocks.findByIdentity(identity)
    if (documentType === ParameterType.DefaultParameter)
      return repos.parameters.findByIdentity(identity)
    if (documentType === FilterType.DefaultFilter)
      return repos.filters.findByIdentity(identity)
    if (documentType === 'type' || documentType === 'primitive')
      return repos.types.findByIdentity(identity)
    if (documentType === 'action')
      return repos.actions.findByIdentity(identity)
    if (documentType === 'converter')
      return repos.converters.findByIdentity(identity)
    if (documentType === 'integration')
      return repos.integrations.findByIdentity(identity)
    if (documentType === 'view')
      return repos.views.findByIdentity(identity)
    if (documentType === 'environment')
      return repos.environments.findByIdentity(identity)
    if (documentType === 'tenant')
      return repos.tenants.findByIdentity(identity)
    if (documentType === 'behavior-binding')
      return repos.behaviorBindings.findByIdentity(identity)
    if (documentType === 'presentation-binding')
      return repos.presentationBindings.findByIdentity(identity)
    if (documentType === 'policy')
      return repos.policies.findByIdentity(identity)
    if (documentType === 'style')
      return repos.styles.findByIdentity(identity)
    if (documentType === 'navigation')
      return repos.navigations.findByIdentity(identity)
    if (documentType === 'vocabs')
      return repos.vocabs.findByIdentity(identity)
    if (documentType === 'auth-profile')
      return repos.authProfiles.findByIdentity(identity)
    if (documentType === 'i18n-bundles')
      return repos.i18nBundles.findByIdentity(identity)
    if (documentType === 'project')
      return repos.projects.findByIdentity(identity)

    return null
  }

  /**
   * Разрешает Document Payload Id For Folder Patch.
   */
  private async resolveDocumentPayloadIdForFolderPatch(
    documentIdOrIdentity: string | number,
    documentType: DomainDocumentType,
    opts?: { forceLookup?: boolean },
  ): Promise<number | string | null> {
    const directPayloadId = this.resolveDocumentPayloadId(documentIdOrIdentity, documentType)
    const doc = this.getDomainDocumentByType(documentType, documentIdOrIdentity) as any
    const identity = String(doc?.identity ?? '').trim()
    const directIdText = typeof directPayloadId === 'string' ? directPayloadId.trim() : ''
    const shouldTryIdentityLookup
      = opts?.forceLookup === true
        || this.isMalformedPayloadDocumentId(directPayloadId)
        || (!!identity && directIdText !== '' && directIdText === identity)

    if (!shouldTryIdentityLookup || !identity) {
      return this.isMalformedPayloadDocumentId(directPayloadId) ? null : directPayloadId
    }

    const payloadDoc = await this.findPayloadDocumentByIdentity(documentType, identity)
    const payloadId = (payloadDoc as any)?.id
    if (!this.isMalformedPayloadDocumentId(payloadId)) {
      if (doc && doc.id !== payloadId)
        doc.id = payloadId
      return payloadId
    }

    return this.isMalformedPayloadDocumentId(directPayloadId) ? null : directPayloadId
  }

  /**
   * Внутренний helper модуля: patch Document Folder By Payload Id.
   */
  private async patchDocumentFolderByPayloadId(
    documentType: DomainDocumentType,
    documentPayloadId: number | string,
    folderPayloadId: number | string | null,
  ): Promise<any> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.changeDocumentFolder] Репозитории не инициализированы. Вызови init().',
      )
    }

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL)
      return repos.components.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === ComponentType.SFC)
      return repos.componentSFCs.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom)
      return repos.queries.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'data-view')
      return repos.dataViews.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'composition')
      return repos.compositions.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'store')
      return repos.stores.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'mock')
      return repos.mocks.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === ParameterType.DefaultParameter)
      return repos.parameters.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === FilterType.DefaultFilter)
      return repos.filters.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'type' || documentType === 'primitive')
      return repos.types.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'action')
      return repos.actions.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'converter')
      return repos.converters.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'integration')
      return repos.integrations.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'view')
      return repos.views.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'environment')
      return repos.environments.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'tenant')
      return repos.tenants.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'behavior-binding')
      return repos.behaviorBindings.patchFolder(documentPayloadId, relationToNumericId(folderPayloadId))
    if (documentType === 'presentation-binding')
      return repos.presentationBindings.patchFolder(documentPayloadId, relationToNumericId(folderPayloadId))
    if (documentType === 'policy')
      return repos.policies.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'style')
      return repos.styles.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'navigation')
      return repos.navigations.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'vocabs')
      return repos.vocabs.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'auth-profile')
      return repos.authProfiles.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'i18n-bundles')
      return repos.i18nBundles.patchFolder(documentPayloadId, folderPayloadId)
    if (documentType === 'project')
      return repos.projects.patchFolder(documentPayloadId, folderPayloadId)

    throw new Error(
      `[EndgeSchemaStorage.changeDocumentFolder] Неподдерживаемый тип документа: ${documentType}`,
    )
  }

  /**
   * Разрешает id папки, который ожидает Payload в relation-поле `folder`.
   * На вход можно передавать id, identity или `null` (корень секции).
   */
  private async resolveFolderPayloadId(
    folderIdOrIdentity: string | number | null,
  ): Promise<number | string | null> {
    if (folderIdOrIdentity == null || String(folderIdOrIdentity).trim() === '')
      return null

    if (typeof folderIdOrIdentity === 'number' && Number.isFinite(folderIdOrIdentity))
      return folderIdOrIdentity

    const fromDomain = Endge.domain.getFolder(folderIdOrIdentity)
    if (fromDomain?.id != null)
      return fromDomain.id

    const text = String(folderIdOrIdentity).trim()
    if (!text)
      return null

    const repos = this.repositories
    if (repos) {
      const fromPayload = await repos.folders.findByIdentity(text)
      if (fromPayload?.id != null)
        return fromPayload.id
    }

    if (/^-?\d+$/.test(text))
      return Number(text)

    return text
  }

  /**
   * Мягкое удаление документа в Payload: по identity находит документ и вызывает PATCH с deletedAt и folder = id папки «soft-deleted».
   * В URL PATCH передаётся id документа (первичный ключ Payload), не identity.
   */
  public async deleteDocument(
    documentIdOrIdentity: string,
    documentType: DomainDocumentType,
  ): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.deleteDocument] Репозитории не инициализированы. Вызови init().',
      )
    }

    const resolvedIdentity = this.resolveDocumentIdentity(documentIdOrIdentity, documentType)
    const softDeletedFolder = await repos.folders.findByIdentity('soft-deleted')
    const folderId = softDeletedFolder?.id

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      await repos.components.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === ComponentType.SFC) {
      await repos.componentSFCs.softDelete(resolvedIdentity, folderId)
      return
    }
    if (
      documentType === QueryType.REST
      || documentType === QueryType.GraphQL
      || documentType === QueryType.Custom
    ) {
      await repos.queries.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === 'data-view') {
      await repos.dataViews.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === 'composition') {
      await repos.compositions.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === 'store') {
      await repos.stores.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === 'mock') {
      await repos.mocks.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === ParameterType.DefaultParameter) {
      await repos.parameters.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === FilterType.DefaultFilter) {
      await repos.filters.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === 'type' || documentType === 'primitive') {
      await repos.types.softDelete(resolvedIdentity, folderId)
      return
    }
    if (documentType === 'project') {
      await repos.projects.softDelete(resolvedIdentity, folderId)
      return
    }

    throw new Error(
      `[EndgeSchemaStorage.deleteDocument] Неподдерживаемый тип документа: ${documentType}`,
    )
  }

  /**
   * Жёсткое удаление документа из Payload (DELETE). Используется для уже удалённых сущностей (из папки «Удалённые»).
   */
  public async deleteDocumentHard(
    documentIdOrIdentity: string,
    documentType: DomainDocumentType,
  ): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.deleteDocumentHard] Репозитории не инициализированы. Вызови init().',
      )
    }

    const resolvedIdentity = this.resolveDocumentIdentity(documentIdOrIdentity, documentType)

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      await repos.components.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === ComponentType.SFC) {
      await repos.componentSFCs.hardDelete(resolvedIdentity)
      return
    }
    if (
      documentType === QueryType.REST
      || documentType === QueryType.GraphQL
      || documentType === QueryType.Custom
    ) {
      await repos.queries.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'data-view') {
      await repos.dataViews.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'composition') {
      await repos.compositions.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'store') {
      await repos.stores.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'mock') {
      await repos.mocks.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === ParameterType.DefaultParameter) {
      await repos.parameters.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === FilterType.DefaultFilter) {
      await repos.filters.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'type' || documentType === 'primitive') {
      await repos.types.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'view') {
      await repos.views.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'environment') {
      await repos.environments.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'tenant') {
      await repos.tenants.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'behavior-binding') {
      await repos.behaviorBindings.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'presentation-binding') {
      await repos.presentationBindings.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'policy') {
      await repos.policies.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'style') {
      await repos.styles.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'vocabs') {
      await repos.vocabs.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'auth-profile') {
      await repos.authProfiles.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'i18n-bundles') {
      await repos.i18nBundles.hardDelete(resolvedIdentity)
      return
    }
    if (documentType === 'project') {
      await repos.projects.hardDelete(resolvedIdentity)
      return
    }

    throw new Error(
      `[EndgeSchemaStorage.deleteDocumentHard] Неподдерживаемый тип документа: ${documentType}`,
    )
  }

  /**
   * Восстановление документа: сброс deletedAt и folder в Payload (перенос в корень секции).
   */
  public async restoreDocument(
    documentIdOrIdentity: string,
    documentType: DomainDocumentType,
  ): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.restoreDocument] Репозитории не инициализированы. Вызови init().',
      )
    }

    const resolvedIdentity = this.resolveDocumentIdentity(documentIdOrIdentity, documentType)

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      await repos.components.restore(resolvedIdentity)
      return
    }
    if (documentType === ComponentType.SFC) {
      await repos.componentSFCs.restore(resolvedIdentity)
      return
    }
    if (
      documentType === QueryType.REST
      || documentType === QueryType.GraphQL
      || documentType === QueryType.Custom
    ) {
      await repos.queries.restore(resolvedIdentity)
      return
    }
    if (documentType === 'data-view') {
      await repos.dataViews.restore(resolvedIdentity)
      return
    }
    if (documentType === 'composition') {
      await repos.compositions.restore(resolvedIdentity)
      return
    }
    if (documentType === 'store') {
      await repos.stores.restore(resolvedIdentity)
      return
    }
    if (documentType === 'mock') {
      await repos.mocks.restore(resolvedIdentity)
      return
    }
    if (documentType === ParameterType.DefaultParameter) {
      await repos.parameters.restore(resolvedIdentity)
      return
    }
    if (documentType === FilterType.DefaultFilter) {
      await repos.filters.restore(resolvedIdentity)
      return
    }
    if (documentType === 'type' || documentType === 'primitive') {
      await repos.types.restore(resolvedIdentity)
      return
    }
    if (documentType === 'project') {
      await repos.projects.restore(resolvedIdentity)
      return
    }

    throw new Error(
      `[EndgeSchemaStorage.restoreDocument] Неподдерживаемый тип документа: ${documentType}`,
    )
  }

  /**
   * Разрешает Folder Entity Type.
   */
  private _resolveFolderEntityType(folder: {
    id?: string | number | null
    identity?: string | number | null
    parent?: string | number | null
    entityType?: string | null
  }): string | null {
    const directType = String(folder.entityType ?? '').trim()
    if (directType)
      return directType

    const visited = new Set<string>()
    let current: {
      id?: string | number | null
      identity?: string | number | null
      parent?: string | number | null
      entityType?: string | null
    } | null = folder

    while (current) {
      const currentEntityType = String(current.entityType ?? '').trim()
      if (currentEntityType)
        return currentEntityType

      const currentIdentity = String(current.identity ?? '').trim()
      if (currentIdentity) {
        const mappedType = ROOT_FOLDER_ENTITY_TYPE_BY_IDENTITY[currentIdentity]
        if (mappedType)
          return mappedType
      }

      const currentKey = String(current.id ?? currentIdentity).trim()
      if (!currentKey || visited.has(currentKey))
        break
      visited.add(currentKey)

      const parentId = current.parent
      if (parentId == null || parentId === '')
        break
      current = Endge.domain.getFolder(parentId)
    }

    return null
  }

  /**
   * Сохраняет папку в Payload (создаёт или обновляет по identity).
   */
  public async saveFolder(folderId: string): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.saveFolder] Репозитории не инициализированы. Вызови init().',
      )
    }
    const folder = Endge.domain.getFolder(folderId)
    if (!folder)
      throw new Error(`Папка не найдена: ${folderId}`)
    const plain = folder.toPlain()
    const identity = String((folder as any).identity ?? plain.id ?? folder.id ?? '')
    if (!identity.trim()) {
      throw new Error(`Папка не имеет identity: ${folderId}`)
    }
    const entityType = this._resolveFolderEntityType({
      id: folder.id,
      identity: (folder as any).identity ?? identity,
      parent: plain.parent ?? null,
      entityType: (folder as any).entityType ?? null,
    })
    if (!entityType) {
      throw new Error(
        `[EndgeSchemaStorage.saveFolder] Не удалось определить entityType для папки "${identity}".`,
      )
    }
    const parent = plain.parent != null ? String(plain.parent) : undefined
    const saved = await repos.folders.upsert({
      identity,
      displayName: plain.displayName ?? plain.name ?? identity,
      entityType,
      parent: parent ?? undefined,
    })
    if (saved && typeof saved === 'object') {
      const payloadId = (saved as any).id
      const payloadIdentity = (saved as any).identity ?? identity
      const payloadDisplay = (saved as any).displayName ?? plain.displayName ?? plain.name ?? identity
      const payloadEntityType = String((saved as any).entityType ?? entityType).trim() || entityType
      const payloadParent = relationToId((saved as any).parent) ?? plain.parent ?? null

      const prevId = folder.id
      const prevIdentity = (folder as any).identity ?? prevId
      const idChanged = payloadId != null && payloadId !== prevId
      const identityChanged = String(payloadIdentity) !== String(prevIdentity)

      if (idChanged || identityChanged) {
        Endge.domain.removeFolderById(prevId)
      }

      folder.id = payloadId ?? folder.id
      ;(folder as any).identity = payloadIdentity
      folder.name = payloadDisplay
      folder.displayName = payloadDisplay
      ;(folder as any).entityType = payloadEntityType
      folder.parent = payloadParent

      if (idChanged || identityChanged) {
        Endge.domain.addFolder(folder)
      }
      else {
        Endge.domain.notify()
      }
    }
  }

  /**
   * Удаляет папку в Payload (DELETE). Дочерние папки на бэкенде переносятся в beforeDelete.
   */
  public async deleteFolder(folderIdentity: string): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.deleteFolder] Репозитории не инициализированы. Вызови init().',
      )
    }
    await repos.folders.deleteByIdentity(folderIdentity)
  }

  /**
   * Синхронизирует behavior bindings указанного owner с Payload и локальным доменом.
   */
  public async syncOwnerBehaviorBindings(opts: {
    ownerType: string
    ownerId: number
    targetType?: string | null
    targetId?: number | null
    projectId?: number | null
    items: Array<{
      id?: number | null
      identity?: string | null
      displayName?: string | null
      projectId?: number | null
      targetType?: string | null
      targetId?: number | null
      eventName?: string | null
      scriptRef?: string | null
      mode?: string | null
      priority?: number | null
      isEnabled?: boolean | null
      environmentId?: number | null
      isInherited?: boolean | null
      originBindingId?: number | null
    }>
  }): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.syncOwnerBehaviorBindings] Репозитории не инициализированы. Вызови init().',
      )
    }

    const normalizeKey = (value: unknown): string => String(value ?? '').trim()
    const normalizeId = (value: unknown): number | null => {
      if (value == null)
        return null
      if (typeof value === 'number')
        return Number.isFinite(value) ? value : null
      const text = normalizeKey(value)
      if (!text)
        return null
      const parsed = Number(text)
      return Number.isFinite(parsed) ? parsed : null
    }
    const ownerType = normalizeKey(opts.ownerType).toLowerCase()
    const ownerId = normalizeId(opts.ownerId)
    if (!ownerType || ownerId == null)
      return

    const fallbackTargetType = normalizeKey(opts.targetType).toLowerCase() || ownerType
    const fallbackTargetId = normalizeId(opts.targetId) ?? ownerId

    const [allBindings, rootBindingsFolder] = await Promise.all([
      repos.behaviorBindings.findAll(),
      repos.folders.findByIdentity('root-behavior-bindings'),
    ])

    const existingOwned = allBindings.filter((doc) => {
      const docOwnerType = normalizeKey((doc as any).ownerType).toLowerCase()
      const docOwnerId = normalizeId((doc as any).ownerId)
      return docOwnerType === ownerType && docOwnerId != null && docOwnerId === ownerId
    })

    const existingByIdentity = new Map<string, any>()
    for (const doc of existingOwned) {
      const identity = normalizeKey((doc as any).identity)
      if (identity)
        existingByIdentity.set(identity, doc)
    }

    const keptIdentities = new Set<string>()
    const now = Date.now()
    let index = 0

    for (const rawItem of opts.items ?? []) {
      index += 1
      if (rawItem?.isInherited === true)
        continue

      const eventName = normalizeKey(rawItem?.eventName)
      const scriptRef = normalizeKey(rawItem?.scriptRef)
      if (!eventName || !scriptRef)
        continue

      const explicitIdentity = normalizeKey(rawItem?.identity)
      const identity = explicitIdentity || `binding-${ownerType}-${ownerId}-${index}-${now}`
      const modeText = normalizeKey(rawItem?.mode).toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable'
        ? modeText
        : 'replace'

      const targetType = normalizeKey(rawItem?.targetType).toLowerCase() || fallbackTargetType
      const targetId = normalizeId(rawItem?.targetId) ?? fallbackTargetId

      const existing = existingByIdentity.get(identity)
      const folderId
        = relationToNumericId((existing as any)?.folderId ?? (existing as any)?.folder ?? rootBindingsFolder?.id ?? null)
      const projectId = normalizeId(rawItem?.projectId ?? opts.projectId)
      const environmentId = normalizeId(rawItem?.environmentId)
      const originBindingId = normalizeId(rawItem?.originBindingId)

      const saved = await repos.behaviorBindings.upsert({
        identity,
        displayName: normalizeKey(rawItem?.displayName) || `${eventName} -> ${scriptRef}`,
        projectId,
        ownerType,
        ownerId,
        targetType,
        targetId,
        eventName,
        scriptRef,
        mode: mode as 'replace' | 'append' | 'prepend' | 'disable',
        priority: Number.isFinite(Number(rawItem?.priority)) ? Number(rawItem?.priority) : 0,
        isEnabled: rawItem?.isEnabled !== false,
        environmentId,
        isInherited: false,
        originBindingId,
        folder: folderId,
      })

      keptIdentities.add(identity)
      this._applyPayloadDocToDomain('behavior-binding', saved, (saved as any)?.id ?? identity, true)
    }

    for (const existing of existingOwned) {
      const identity = normalizeKey((existing as any).identity)
      if (!identity || keptIdentities.has(identity))
        continue
      await repos.behaviorBindings.hardDelete(identity)
      this._removeDomainDocumentByType('behavior-binding', (existing as any).id ?? identity)
    }
  }

  /**
   * Синхронизирует presentation bindings указанного owner с Payload и локальным доменом.
   */
  public async syncOwnerPresentationBindings(opts: {
    ownerType: string
    ownerId: number
    targetType?: string | null
    targetId?: number | null
    projectId?: number | null
    items: Array<{
      id?: number | null
      identity?: string | null
      displayName?: string | null
      projectId?: number | null
      targetType?: string | null
      targetId?: number | null
      role?: string | null
      rendererRef?: string | null
      when?: string | null
      mode?: string | null
      priority?: number | null
      isEnabled?: boolean | null
      environmentId?: number | null
      isInherited?: boolean | null
      originBindingId?: number | null
    }>
  }): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.syncOwnerPresentationBindings] Репозитории не инициализированы. Вызови init().',
      )
    }

    const normalizeKey = (value: unknown): string => String(value ?? '').trim()
    const normalizeId = (value: unknown): number | null => {
      if (value == null)
        return null
      if (typeof value === 'number')
        return Number.isFinite(value) ? value : null
      const text = normalizeKey(value)
      if (!text)
        return null
      const parsed = Number(text)
      return Number.isFinite(parsed) ? parsed : null
    }
    const ownerType = normalizeKey(opts.ownerType).toLowerCase()
    const ownerId = normalizeId(opts.ownerId)
    if (!ownerType || ownerId == null)
      return

    const fallbackTargetType = normalizeKey(opts.targetType).toLowerCase() || ownerType
    const fallbackTargetId = normalizeId(opts.targetId) ?? ownerId

    const [allBindings, rootFolder] = await Promise.all([
      repos.presentationBindings.findAll(),
      repos.folders.findByIdentity('root-presentation-bindings'),
    ])

    const existingOwned = allBindings.filter((doc) => {
      const docOwnerType = normalizeKey((doc as any).ownerType).toLowerCase()
      const docOwnerId = normalizeId((doc as any).ownerId)
      return docOwnerType === ownerType && docOwnerId != null && docOwnerId === ownerId
    })

    const existingByIdentity = new Map<string, any>()
    for (const doc of existingOwned) {
      const identity = normalizeKey((doc as any).identity)
      if (identity)
        existingByIdentity.set(identity, doc)
    }

    const keptIdentities = new Set<string>()
    const now = Date.now()
    let index = 0

    for (const rawItem of opts.items ?? []) {
      index += 1
      if (rawItem?.isInherited === true)
        continue

      const role = normalizeKey(rawItem?.role)
      const rendererRef = normalizeKey(rawItem?.rendererRef)
      if (!role || !rendererRef)
        continue

      const explicitIdentity = normalizeKey(rawItem?.identity)
      const identity = explicitIdentity || `presentation-binding-${ownerType}-${ownerId}-${index}-${now}`
      const modeText = normalizeKey(rawItem?.mode).toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable'
        ? modeText
        : 'replace'

      const targetType = normalizeKey(rawItem?.targetType).toLowerCase() || fallbackTargetType
      const targetId = normalizeId(rawItem?.targetId) ?? fallbackTargetId
      const existing = existingByIdentity.get(identity)
      const folderId = relationToNumericId((existing as any)?.folderId ?? (existing as any)?.folder ?? rootFolder?.id ?? null)

      const saved = await repos.presentationBindings.upsert({
        identity,
        displayName: normalizeKey(rawItem?.displayName) || `${role} -> ${rendererRef}`,
        projectId: normalizeId(rawItem?.projectId ?? opts.projectId),
        ownerType,
        ownerId,
        targetType,
        targetId,
        role,
        rendererRef,
        when: normalizeKey(rawItem?.when) || null,
        mode: mode as 'replace' | 'append' | 'prepend' | 'disable',
        priority: Number.isFinite(Number(rawItem?.priority)) ? Number(rawItem?.priority) : 0,
        isEnabled: rawItem?.isEnabled !== false,
        environmentId: normalizeId(rawItem?.environmentId),
        isInherited: false,
        originBindingId: normalizeId(rawItem?.originBindingId),
        folder: folderId,
      })

      keptIdentities.add(identity)
      this._applyPayloadDocToDomain('presentation-binding', saved, (saved as any)?.id ?? identity, true)
    }

    for (const existing of existingOwned) {
      const identity = normalizeKey((existing as any).identity)
      if (!identity || keptIdentities.has(identity))
        continue
      await repos.presentationBindings.hardDelete(identity)
      this._removeDomainDocumentByType('presentation-binding', (existing as any).id ?? identity)
    }
  }

  /**
   * Прямой upsert payload-документа (JSON) по выбранному типу.
   * Используется для advanced-режима в модалке создания документов.
   */
  public async upsertPayloadDocumentRaw(
    documentType: DomainDocumentType,
    payloadDoc: Record<string, unknown>,
  ): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.upsertPayloadDocumentRaw] Репозитории не инициализированы. Вызови init().',
      )
    }

    if (!payloadDoc || typeof payloadDoc !== 'object' || Array.isArray(payloadDoc))
      throw new Error('JSON документа должен быть объектом')

    const data = { ...(payloadDoc as Record<string, any>) }
    const identity = String(data.identity ?? '').trim()
    if (!identity)
      throw new Error('В JSON обязательно поле "identity"')

    data.identity = identity
    if (data.displayName == null || String(data.displayName).trim() === '')
      data.displayName = String(data.name ?? identity)

    if (data.folder === undefined && data.folderId !== undefined)
      data.folder = data.folderId
    if (data.folder !== undefined)
      data.folder = await this.resolveFolderPayloadId(relationToId(data.folder) ?? null)

    let saved: any = null

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      saved = await repos.components.upsert(data as any)
    }
    else if (documentType === ComponentType.SFC) {
      data.source = typeof data.source === 'string' ? data.source : ''
      data.supportedTargets = normalizeComponentSFCTargets(data.supportedTargets)
      data.modelVersion = Number(data.modelVersion ?? 1)
      data.meta = (data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)) ? data.meta : {}
      saved = await repos.componentSFCs.upsert(data as any)
    }
    else if (
      documentType === QueryType.REST
      || documentType === QueryType.GraphQL
      || documentType === QueryType.Custom
    ) {
      data.source = typeof data.source === 'string' ? data.source : ''
      data.sourceVersion = Number(data.sourceVersion ?? 2) || 2
      saved = await repos.queries.upsert(data as any)
    }
    else if (documentType === 'data-view') {
      data.source = typeof data.source === 'string' ? data.source : ''
      data.sourceVersion = Number(data.sourceVersion ?? 1)
      data.meta = (data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)) ? data.meta : {}
      saved = await repos.dataViews.upsert(data as any)
    }
    else if (documentType === 'composition') {
      data.source = typeof data.source === 'string' ? data.source : ''
      data.sourceVersion = Number(data.sourceVersion ?? 1)
      data.meta = (data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)) ? data.meta : {}
      saved = await repos.compositions.upsert(data as any)
    }
    else if (documentType === 'store') {
      data.source = typeof data.source === 'string' ? data.source : ''
      data.sourceVersion = Number(data.sourceVersion ?? 1)
      data.meta = (data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)) ? data.meta : {}
      saved = await repos.stores.upsert(data as any)
    }
    else if (documentType === 'mock') {
      data.contentSource = data.contentSource === 'code-provider' ? 'code-provider' : 'document'
      data.contentType = data.contentType === 'text/plain' ? 'text/plain' : 'application/json'
      data.source = typeof data.source === 'string' ? data.source : '{}'
      data.codeRef = String(data.codeRef ?? '').trim() || null
      data.meta = (data.meta && typeof data.meta === 'object' && !Array.isArray(data.meta)) ? data.meta : {}
      saved = await repos.mocks.upsert(data as any)
    }
    else if (documentType === 'action') {
      saved = await repos.actions.upsert(data as any)
    }
    else if (documentType === 'integration') {
      saved = await repos.integrations.upsert(data as any)
    }
    else if (documentType === 'view') {
      saved = await repos.views.upsert(data as any)
    }
    else if (documentType === 'environment') {
      saved = await repos.environments.upsert(data as any)
    }
    else if (documentType === 'tenant') {
      saved = await repos.tenants.upsert(data as any)
    }
    else if (documentType === 'policy') {
      saved = await repos.policies.upsert(data as any)
    }
    else if (documentType === 'style') {
      saved = await repos.styles.upsert(data as any)
    }
    else if (documentType === 'page-template') {
      saved = await repos.pageTemplates.upsert(data as any)
    }
    else if (documentType === 'page') {
      saved = await repos.pages.upsert(data as any)
    }
    else if (documentType === 'navigation') {
      saved = await repos.navigations.upsert(data as any)
    }
    else if (documentType === 'vocabs') {
      saved = await repos.vocabs.upsert(data as any)
    }
    else if (documentType === 'auth-profile') {
      const payload = data as Record<string, any>
      if (payload.folder == null) {
        const folderId = await this.ensurePayloadRootFolder({
          identity: 'root-auth-profiles',
          displayName: 'Аутентификация',
          entityType: 'auth-profiles',
        })
        if (folderId != null)
          payload.folder = folderId
      }
      saved = await repos.authProfiles.upsert(payload as any)
    }
    else if (documentType === 'i18n-bundles') {
      saved = await repos.i18nBundles.upsert(data as any)
    }
    else if (documentType === 'project') {
      saved = await repos.projects.upsert(data as any)
    }
    else {
      throw new Error(
        `[EndgeSchemaStorage.upsertPayloadDocumentRaw] Неподдерживаемый тип документа: ${documentType}`,
      )
    }

    this._applyPayloadDocToDomain(documentType, saved, identity, true)
  }

  /**
   * Сохраняет один документ в Payload по типу: дергает нужный репозиторий и upsert.
   */
  public async saveDocument(
    documentId: string | number,
    documentType: DomainDocumentType,
    opts?: { model?: unknown },
  ): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.saveDocument] Репозитории не инициализированы. Вызови init().',
      )
    }

    const domain = Endge.domain

    if (documentType === 'workspace') {
      const workspace = normalizeEndgeWorkspaceDefinition(opts?.model ?? Endge.workspace.current)
      const saved = await repos.workspaces!.upsert({
        identity: workspace.identity,
        displayName: workspace.displayName,
        vars: workspace.vars.map(item => ({
          name: item.name,
          defaultValue: item.defaultValue,
        })),
        sse: workspace.sse
          ? {
              url: workspace.sse.url,
              authMode: workspace.sse.authMode ?? 'inherit',
              authProfileIdentity: workspace.sse.authProfileIdentity ?? null,
              manualToken: workspace.sse.manualToken ?? null,
            }
          : undefined,
        locales: workspace.locales.map(locale => ({
          identity: locale.code,
          displayName: locale.displayName || locale.code,
          code: locale.code,
          shortLabel: locale.shortLabel,
          direction: locale.direction ?? 'ltr',
        })),
        defaultLocale: workspace.defaultLocale,
        fallbackLocale: workspace.fallbackLocale,
        defaultAuthProfileIdentity: workspace.defaultAuthProfileIdentity,
        sfcAdapterIds: [...workspace.sfcAdapterIds],
        defaultSfcAdapterId: workspace.defaultSfcAdapterId,
      })
      Endge.workspace.apply(saved)
      ;(AppBus.emit as (event: string, payload?: unknown) => void)('domainChanged', undefined)
      return
    }

    if (documentType === 'type' || documentType === 'primitive') {
      const type = ((opts?.model as any) ?? domain.getType(documentId)) as any
      if (!type || type.isPrimitive)
        throw new Error(`Тип не найден или примитив: ${documentId}`)
      const schema = Serialize.toPlain(type)
      const saved = await repos.types.upsert({
        identity: type.name,
        displayName: type.name,
        schema,
        meta: (type.meta && typeof type.meta === 'object' && !Array.isArray(type.meta)) ? type.meta : {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      const component = ((opts?.model as any) ?? domain.getComponent(documentId)) as any
      if (!component)
        throw new Error(`Компонент не найден: ${documentId}`)
      const [componentsList, convertersList] = await Promise.all([
        repos.components.findAll(),
        repos.converters.findAll(),
      ])
      const componentIdentityToId = new Map<string, number>()
      const converterIdentityToId = new Map<string, number>()
      for (const d of componentsList as any[]) {
        if (d.identity != null)
          componentIdentityToId.set(String(d.identity), d.id)
      }
      for (const d of convertersList as any[]) {
        if (d.identity != null)
          converterIdentityToId.set(String(d.identity), d.id)
      }
      const payloadData = ReflectComponentToPayloadData(component, componentIdentityToId, converterIdentityToId)
      const componentIdentity = String((component as any).identity ?? component.id ?? '')
      const existing = await repos.components.findByIdentity(componentIdentity)
      let saved: any = null
      if (existing) {
        saved = await repos.components.update((existing as any).id, payloadData)
      }
      else {
        const rootFolder = await repos.folders.findByIdentity('root-components')
        const folderId = rootFolder?.id
        saved = await repos.components.create({
          identity: payloadData.identity,
          displayName: payloadData.displayName,
          ...payloadData,
          folder: folderId,
          schema: ReflectComponentToPlain(component) ?? {},
        })
      }
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === ComponentType.SFC) {
      const component = ((opts?.model as any) ?? domain.getComponentSFC(documentId)) as RComponentSFC | null
      if (!component)
        throw new Error(`SFC-компонент не найден: ${documentId}`)

      const existing = await repos.componentSFCs.findByIdentity(component.identity)
      const fallbackFolder = existing?.folder ?? await resolveDefaultComponentFolder(repos)
      const folder = component.folderId ?? relationToId(fallbackFolder) ?? null
      const saved = await repos.componentSFCs.upsert({
        identity: component.identity,
        displayName: component.displayName ?? component.name ?? component.identity,
        folder,
        project: component.project ?? null,
        source: component.source ?? '',
        supportedTargets: normalizeComponentSFCTargets(component.supportedTargets),
        modelVersion: Number(component.modelVersion ?? 1),
        meta: (component.meta && typeof component.meta === 'object' && !Array.isArray(component.meta)) ? component.meta : {},
        active: component.active ?? true,
        author: component.author ?? undefined,
        inherited: component.inherited === true,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (
      documentType === QueryType.REST
      || documentType === QueryType.GraphQL
      || documentType === QueryType.Custom
    ) {
      const query = ((opts?.model as any) ?? domain.getQuery(documentId)) as any
      if (!query)
        throw new Error(`Запрос не найден: ${documentId}`)
      const plain = Serialize.toPlain(query) as Record<string, any>
      const queryIdentity = String((query as any).identity ?? query.id ?? '')
      const existing = await repos.queries.findByIdentity(queryIdentity)
      const payload: Partial<QueriesPayloadFields> & Pick<QueriesPayloadFields, 'identity' | 'displayName'> = {
        identity: queryIdentity,
        displayName: query.name ?? query.id,
        source: plain.source,
        sourceVersion: plain.sourceVersion,
        meta: (query.meta && typeof query.meta === 'object' && !Array.isArray(query.meta)) ? query.meta : {},
        inherited: Boolean((query as any).inherited),
      }
      const saved = existing
        ? await repos.queries.update((existing as any).id, payload)
        : await repos.queries.create(payload)
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'data-view') {
      const dataView = ((opts?.model as any) ?? domain.getDataView(documentId)) as any
      if (!dataView)
        throw new Error(`DataView не найден: ${documentId}`)

      const existing = await repos.dataViews.findByIdentity(dataView.identity)
      const fallbackFolder = existing?.folder ?? await resolveDefaultFolderByIdentity(repos, 'root-data-views')
      const folder = dataView.folderId ?? relationToId(fallbackFolder) ?? null
      const saved = await repos.dataViews.upsert({
        identity: String(dataView.identity ?? documentId),
        displayName: dataView.displayName ?? dataView.name ?? String(dataView.identity ?? documentId),
        description: dataView.description ?? null,
        folder,
        project: dataView.project ?? null,
        source: dataView.source ?? '',
        sourceVersion: Number(dataView.sourceVersion ?? 1),
        meta: (dataView.meta && typeof dataView.meta === 'object' && !Array.isArray(dataView.meta)) ? dataView.meta : {},
        active: dataView.active ?? true,
        author: dataView.author ?? undefined,
        inherited: dataView.inherited === true,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'composition') {
      const composition = ((opts?.model as any) ?? domain.getComposition(documentId)) as any
      if (!composition)
        throw new Error(`Composition не найдена: ${documentId}`)

      const existing = await repos.compositions.findByIdentity(composition.identity)
      const fallbackFolder = existing?.folder ?? await resolveDefaultFolderByIdentity(repos, 'root-compositions')
      const folder = composition.folderId ?? relationToId(fallbackFolder) ?? null
      const saved = await repos.compositions.upsert({
        identity: String(composition.identity ?? documentId),
        displayName: composition.displayName ?? composition.name ?? String(composition.identity ?? documentId),
        description: composition.description ?? null,
        folder,
        project: composition.project ?? null,
        source: composition.source ?? '',
        sourceVersion: Number(composition.sourceVersion ?? 1),
        meta: (composition.meta && typeof composition.meta === 'object' && !Array.isArray(composition.meta)) ? composition.meta : {},
        active: composition.active ?? true,
        author: composition.author ?? undefined,
        inherited: composition.inherited === true,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'store') {
      const store = ((opts?.model as any) ?? domain.getStore(documentId)) as any
      if (!store)
        throw new Error(`Store не найден: ${documentId}`)

      const existing = await repos.stores.findByIdentity(store.identity)
      const fallbackFolder = existing?.folder ?? await resolveDefaultFolderByIdentity(repos, 'root-stores')
      const folder = store.folderId ?? relationToId(fallbackFolder) ?? null
      const payload = {
        identity: String(store.identity ?? documentId),
        displayName: store.displayName ?? store.name ?? String(store.identity ?? documentId),
        description: store.description ?? null,
        folder,
        project: store.project ?? null,
        source: store.source ?? '',
        sourceVersion: Number(store.sourceVersion ?? 1),
        meta: (store.meta && typeof store.meta === 'object' && !Array.isArray(store.meta)) ? store.meta : {},
        active: store.active ?? true,
        author: store.author ?? undefined,
        inherited: store.inherited === true,
      }
      const storageId = store.id
      const saved = !this.isMalformedPayloadDocumentId(storageId)
        ? await repos.stores.update(storageId, payload)
        : await repos.stores.upsert(payload)
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'mock') {
      const mock = ((opts?.model as any) ?? domain.getMock(documentId)) as any
      if (!mock)
        throw new Error(`Mock не найден: ${documentId}`)

      const existing = await repos.mocks.findByIdentity(mock.identity)
      const fallbackFolder = existing?.folder ?? await resolveDefaultFolderByIdentity(repos, 'root-mocks')
      const folder = mock.folderId ?? relationToId(fallbackFolder) ?? null
      const payload = {
        identity: String(mock.identity ?? documentId),
        displayName: mock.displayName ?? mock.name ?? String(mock.identity ?? documentId),
        description: mock.description ?? null,
        folder,
        project: mock.project ?? null,
        contentSource: mock.contentSource === 'code-provider' ? 'code-provider' as const : 'document' as const,
        contentType: mock.contentType === 'text/plain' ? 'text/plain' as const : 'application/json' as const,
        source: typeof mock.source === 'string' ? mock.source : '{}',
        codeRef: String(mock.codeRef ?? '').trim() || null,
        meta: (mock.meta && typeof mock.meta === 'object' && !Array.isArray(mock.meta)) ? mock.meta : {},
        active: mock.active ?? true,
        author: mock.author ?? undefined,
        inherited: mock.inherited === true,
      }
      const storageId = mock.id
      const saved = !this.isMalformedPayloadDocumentId(storageId)
        ? await repos.mocks.update(storageId, payload)
        : await repos.mocks.upsert(payload)
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'action') {
      const action = ((opts?.model as any) ?? domain.getAction(documentId)) as any
      if (!action)
        throw new Error(`Действие не найдено: ${documentId}`)

      const rawEditorFlowDefinition = typeof (opts?.model as any)?.flowEditor?.toDefinition === 'function'
        ? (opts?.model as any).flowEditor.toDefinition()
        : null

      const plain = typeof action.toPlain === 'function'
        ? action.toPlain()
        : {
            id: action.id,
            identity: action.identity,
            displayName: action.displayName ?? action.name ?? action.identity,
            description: action.description ?? null,
            project: action.project ?? null,
            folderId: action.folderId ?? null,
            definition: normalizeFlowDefinition(action.definition),
            input: action.input ?? null,
            output: action.output ?? null,
          }

      const actionIdentity = String((action as any).identity ?? plain.identity ?? action.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.actions.findByIdentity(actionIdentity)

      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else if (plain.folderId != null) {
        folderId = plain.folderId as number | string
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-actions')
        folderId = folderDoc?.id
      }

      const saved = await repos.actions.upsert({
        identity: actionIdentity,
        displayName: String(plain.displayName ?? plain.name ?? actionIdentity),
        description: plain.description ?? null,
        definition: normalizeFlowDefinition(rawEditorFlowDefinition ?? plain.definition),
        input: toPayloadActionField(plain.input),
        output: toPayloadActionField(plain.output),
        project: plain.project ?? null,
        folder: folderId,
        active: action.active !== false,
        ...(action.author != null && action.author !== '' && { author: action.author }),
      })

      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === ParameterType.DefaultParameter) {
      const parameter = ((opts?.model as any) ?? domain.getParameter(documentId)) as any
      if (!parameter)
        throw new Error(`Параметр не найден: ${documentId}`)
      const plain = parameter.toPlain()
      const saved = await repos.parameters.upsert({
        identity: plain.identity,
        displayName: plain.displayName,
        description: plain.description,
        folder: plain.folderId ?? plain.folder ?? undefined,
        ...(plain.author != null && plain.author !== '' && { author: plain.author }),
        active: plain.active,
        fields: plain.fields,
        runtimeFilters: (plain as any).runtimeFilters,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === FilterType.DefaultFilter) {
      const filter = ((opts?.model as any) ?? domain.getFilter(documentId)) as any
      if (!filter)
        throw new Error(`Фильтр не найден: ${documentId}`)
      const plain = filter.toPlain()
      const folderId: number | string | undefined = plain.folderId ?? (plain as any).folder ?? undefined
      const fieldsForPayload = (plain.fields ?? []).map((f: any) => ({
        ...f,
        active: f.active !== false,
        converterIdentities: (f.converterIdentities ?? []).map((id: string) => ({ identity: id })),
      }))
      // Унаследованные фильтры могут иметь одинаковый displayName - делаем уникальным для Payload (unique на displayName)
      const displayNameForPayload = plain.inherited
        ? `${plain.displayName} (${plain.identity})`
        : plain.displayName
      const saved = await repos.filters.upsert({
        identity: plain.identity,
        displayName: displayNameForPayload,
        folder: folderId as number | string | undefined,
        ...(plain.author != null && plain.author !== '' && { author: plain.author }),
        active: plain.active,
        fields: fieldsForPayload,
        source: String(plain.source ?? ''),
        sourceVersion: Number(plain.sourceVersion ?? 1) || 1,
        meta: (plain.meta && typeof plain.meta === 'object' && !Array.isArray(plain.meta)) ? plain.meta : {},
        inherited: Boolean(plain.inherited ?? filter.inherited),
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'converter') {
      const converter = ((opts?.model as any) ?? domain.getConverter(documentId)) as any
      if (!converter)
        throw new Error(`Конвертер не найден: ${documentId}`)
      const plain = converter.toPlain()
      const converterIdentity = String((converter as any).identity ?? plain.id ?? converter.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.converters.findByIdentity(converterIdentity)
      if (existing && (((existing as any).folderId ?? existing.folder) != null)) {
        folderId = (existing as any).folderId ?? existing.folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-converters')
        folderId = folderDoc?.id
      }
      const saved = await repos.converters.upsert({
        identity: converterIdentity,
        displayName: plain.name,
        description: plain.description ?? undefined,
        isSystem: plain.isSystem,
        folder: folderId,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'integration') {
      const integration = ((opts?.model as any) ?? domain.getIntegration(documentId)) as any
      if (!integration)
        throw new Error(`Интеграция не найдена: ${documentId}`)
      const plain = integration.toPlain()
      const integrationIdentity = String((integration as any).identity ?? plain.id ?? integration.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.integrations.findByIdentity(integrationIdentity)
      if (existing && (((existing as any).folderId ?? existing.folder) != null)) {
        folderId = (existing as any).folderId ?? existing.folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-integrations')
        folderId = folderDoc?.id
      }
      const saved = await repos.integrations.upsert({
        identity: integrationIdentity,
        displayName: plain.name,
        description: plain.description ?? undefined,
        isSystem: plain.isSystem,
        folder: folderId,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'environment') {
      const environment = ((opts?.model as any) ?? domain.getEnvironment(documentId)) as any
      if (!environment)
        throw new Error(`Окружение не найдено: ${documentId}`)
      const plain = environment.toPlain() as { id: string, name: string, folder?: string | null, isSystem?: boolean }
      const environmentIdentity = String((environment as any).identity ?? plain.id ?? environment.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.environments.findByIdentity(environmentIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-environments')
        folderId = folderDoc?.id
      }
      const saved = await repos.environments.upsert({
        identity: environmentIdentity,
        displayName: plain.name,
        isSystem: plain.isSystem,
        folder: folderId,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'tenant') {
      const tenant = ((opts?.model as any) ?? domain.getTenant(documentId)) as any
      if (!tenant)
        throw new Error(`Тенант не найден: ${documentId}`)
      const plain = tenant.toPlain() as { id: string, name: string, displayName?: string, code?: string, description?: string | null }
      const tenantIdentity = String((tenant as any).identity ?? plain.id ?? tenant.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.tenants.findByIdentity(tenantIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-tenants')
        folderId = folderDoc?.id
      }
      const saved = await repos.tenants.upsert({
        identity: tenantIdentity,
        displayName: plain.displayName ?? plain.name ?? tenantIdentity,
        code: String(plain.code ?? tenantIdentity).trim() || tenantIdentity,
        description: plain.description ?? null,
        folder: folderId,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'behavior-binding') {
      const binding = ((opts?.model as any) ?? domain.getBehaviorBinding(documentId)) as any
      if (!binding)
        throw new Error(`Биндинг не найден: ${documentId}`)
      const plain = binding.toPlain() as {
        id: number
        name: string
        displayName?: string
        projectId?: number | null
        ownerType?: string
        ownerId?: number | null
        targetType?: string
        targetId?: number | null
        eventName?: string
        scriptRef?: string
        mode?: string
        priority?: number
        isEnabled?: boolean
        environmentId?: number | null
        isInherited?: boolean
        originBindingId?: number | null
      }
      const bindingIdentity = String((binding as any).identity ?? plain.id ?? binding.id ?? '')
      let folderId: number | null | undefined
      const existing = await repos.behaviorBindings.findByIdentity(bindingIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = relationToNumericId((existing as any).folderId ?? (existing as any).folder)
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-behavior-bindings')
        folderId = relationToNumericId(folderDoc?.id)
      }
      const modeText = String(plain.mode ?? 'replace').trim().toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable' ? modeText : 'replace'
      const ownerId = relationToNumericId(plain.ownerId)
      const targetId = relationToNumericId(plain.targetId)
      if (ownerId == null || targetId == null)
        throw new Error(`Некорректные ownerId/targetId биндинга: ${bindingIdentity}`)
      const saved = await repos.behaviorBindings.upsert({
        identity: bindingIdentity,
        displayName: plain.displayName ?? plain.name ?? bindingIdentity,
        projectId: relationToNumericId(plain.projectId) ?? null,
        ownerType: String(plain.ownerType ?? 'view').trim() || 'view',
        ownerId,
        targetType: String(plain.targetType ?? 'view').trim() || 'view',
        targetId,
        eventName: String(plain.eventName ?? '').trim(),
        scriptRef: String(plain.scriptRef ?? '').trim(),
        mode: mode as 'replace' | 'append' | 'prepend' | 'disable',
        priority: Number.isFinite(Number(plain.priority)) ? Number(plain.priority) : 0,
        isEnabled: plain.isEnabled !== false,
        environmentId: relationToNumericId(plain.environmentId) ?? null,
        isInherited: plain.isInherited === true,
        originBindingId: relationToNumericId(plain.originBindingId) ?? null,
        folder: folderId,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'presentation-binding') {
      const binding = ((opts?.model as any) ?? domain.getPresentationBinding(documentId)) as any
      if (!binding)
        throw new Error(`Presentation binding не найден: ${documentId}`)
      const plain = binding.toPlain() as {
        id: number
        name: string
        displayName?: string
        projectId?: number | null
        ownerType?: string
        ownerId?: number | null
        targetType?: string
        targetId?: number | null
        role?: string
        rendererRef?: string
        when?: string | null
        mode?: string
        priority?: number
        isEnabled?: boolean
        environmentId?: number | null
        isInherited?: boolean
        originBindingId?: number | null
      }
      const bindingIdentity = String((binding as any).identity ?? plain.id ?? binding.id ?? '')
      let folderId: number | null | undefined
      const existing = await repos.presentationBindings.findByIdentity(bindingIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = relationToNumericId((existing as any).folderId ?? (existing as any).folder)
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-presentation-bindings')
        folderId = relationToNumericId(folderDoc?.id)
      }
      const modeText = String(plain.mode ?? 'replace').trim().toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable' ? modeText : 'replace'
      const ownerId = relationToNumericId(plain.ownerId)
      if (ownerId == null)
        throw new Error(`Некорректный ownerId presentation биндинга: ${bindingIdentity}`)
      const saved = await repos.presentationBindings.upsert({
        identity: bindingIdentity,
        displayName: plain.displayName ?? plain.name ?? bindingIdentity,
        projectId: relationToNumericId(plain.projectId) ?? null,
        ownerType: String(plain.ownerType ?? 'project').trim() || 'project',
        ownerId,
        targetType: String(plain.targetType ?? 'component').trim() || 'component',
        targetId: relationToNumericId(plain.targetId) ?? null,
        role: String(plain.role ?? '').trim(),
        rendererRef: String(plain.rendererRef ?? '').trim(),
        when: plain.when ?? null,
        mode: mode as 'replace' | 'append' | 'prepend' | 'disable',
        priority: Number.isFinite(Number(plain.priority)) ? Number(plain.priority) : 0,
        isEnabled: plain.isEnabled !== false,
        environmentId: relationToNumericId(plain.environmentId) ?? null,
        isInherited: plain.isInherited === true,
        originBindingId: relationToNumericId(plain.originBindingId) ?? null,
        folder: folderId,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'policy') {
      const policy = ((opts?.model as any) ?? domain.getPolicy(documentId)) as any
      if (!policy)
        throw new Error(`Политика не найдена: ${documentId}`)
      const plain = policy.toPlain() as { id: string, name: string, description?: string | null, folder?: string | null }
      const policyIdentity = String((policy as any).identity ?? plain.id ?? policy.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.policies.findByIdentity(policyIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-policies')
        folderId = folderDoc?.id
      }
      const saved = await repos.policies.upsert({
        identity: policyIdentity,
        displayName: plain.name,
        description: plain.description ?? undefined,
        folder: folderId,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'style') {
      const style = ((opts?.model as any) ?? domain.getStyle(documentId)) as any
      if (!style)
        throw new Error(`Стиль не найден: ${documentId}`)
      const plain = style.toPlain() as { id: string, name: string, folder?: string | null, project?: string | null, styles: Record<string, unknown>, meta: Record<string, unknown>, inherited: boolean, isSystem: boolean }
      const styleIdentity = String((style as any).identity ?? plain.id ?? style.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.styles.findByIdentity(styleIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-styles')
        folderId = folderDoc?.id
      }
      const saved = await repos.styles.upsert({
        identity: styleIdentity,
        displayName: plain.name,
        styles: plain.styles ?? {},
        folder: folderId,
        project: plain.project ?? undefined,
        isSystem: plain.isSystem,
        inherited: plain.inherited,
        meta: plain.meta ?? {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'vocabs') {
      const vocab = ((opts?.model as any) ?? domain.getVocab(documentId)) as any
      if (!vocab)
        throw new Error(`Словарь не найден: ${documentId}`)
      const plain = vocab.toPlain() as {
        id: string
        identity: string
        name: string
        displayName?: string
        description?: string | null
        mode: 'external_payload' | 'internal'
        baseApiUrl?: string | null
        collectionSlug?: string | null
        authMode?: 'inherit' | 'profile' | 'manual' | 'none'
        authProfileIdentity?: string | null
        active?: boolean
        folderId?: string | number | null
        meta?: Record<string, unknown>
      }
      const vocabIdentity = String((vocab as any).identity ?? plain.id ?? vocab.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.vocabs.findByIdentity(vocabIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-vocabs')
        folderId = folderDoc?.id
      }
      const saved = await repos.vocabs.upsert({
        identity: vocabIdentity,
        displayName: plain.displayName ?? plain.name ?? vocabIdentity,
        description: plain.description ?? null,
        mode: plain.mode ?? 'external_payload',
        baseApiUrl: plain.baseApiUrl ?? null,
        collectionSlug: plain.collectionSlug ?? null,
        authMode: plain.authMode ?? 'inherit',
        authProfileIdentity: plain.authProfileIdentity ?? null,
        active: plain.active !== false,
        folder: folderId,
        deletedAt: null,
        meta: plain.meta ?? {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'auth-profile') {
      const profile = ((opts?.model as any) ?? domain.getAuthProfile(documentId)) as any
      if (!profile)
        throw new Error(`Профиль авторизации не найден: ${documentId}`)
      const plain = profile.toPlain() as {
        id: string | number
        identity: string
        name: string
        displayName?: string
        description?: string | null
        adapterId?: 'keycloak_manual' | 'keycloak_form' | 'manual_token'
        config?: Record<string, unknown>
        credentialRefs?: Record<string, string | undefined>
        persist?: 'localStorage' | 'sessionStorage' | 'memory'
        active?: boolean
        folderId?: string | number | null
        meta?: Record<string, unknown>
      }
      const profileIdentity = String((profile as any).identity ?? plain.identity ?? plain.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.authProfiles.findByIdentity(profileIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        folderId = await this.ensurePayloadRootFolder({
          identity: 'root-auth-profiles',
          displayName: 'Аутентификация',
          entityType: 'auth-profiles',
        }) ?? undefined
      }
      const saved = await repos.authProfiles.upsert({
        identity: profileIdentity,
        displayName: plain.displayName ?? plain.name ?? profileIdentity,
        description: plain.description ?? null,
        adapterId: plain.adapterId ?? 'manual_token',
        config: plain.config ?? {},
        credentialRefs: plain.credentialRefs ?? {},
        persist: plain.persist ?? 'localStorage',
        active: plain.active !== false,
        folder: folderId,
        deletedAt: null,
        meta: plain.meta ?? {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'i18n-bundles') {
      const bundle = ((opts?.model as any) ?? domain.getI18nBundle(documentId)) as any
      if (!bundle)
        throw new Error(`Словарь переводов не найден: ${documentId}`)
      const plain = bundle.toPlain() as {
        id: string
        identity: string
        name: string
        displayName?: string
        description?: string | null
        locales?: Record<string, Record<string, unknown>>
        active?: boolean
        folderId?: string | number | null
      }
      const bundleIdentity = String((bundle as any).identity ?? plain.id ?? bundle.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.i18nBundles.findByIdentity(bundleIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-i18n-bundles')
        folderId = folderDoc?.id
      }
      const saved = await repos.i18nBundles.upsert({
        identity: bundleIdentity,
        displayName: plain.displayName ?? plain.name ?? bundleIdentity,
        description: plain.description ?? null,
        locales: plain.locales ?? {},
        active: plain.active !== false,
        folder: folderId,
        deletedAt: null,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'view') {
      const view = ((opts?.model as any) ?? domain.getView(documentId)) as any
      if (!view)
        throw new Error(`Вид не найден: ${documentId}`)
      const plain = view.toPlain()
      let folderId: number | string | undefined
      const existing = await repos.views.findByIdentity(plain.identity)
      if (existing && (((existing as any).folderId ?? existing.folder) != null)) {
        folderId = (existing as any).folderId ?? existing.folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-views')
        folderId = folderDoc?.id
      }
      const comp = plain.componentId ? domain.getComponent(plain.componentId) : null
      const compDoc = comp ? await repos.components.findByIdentity((comp as any).identity ?? String(comp.id)) : null
      const filter = plain.filterId ? domain.getFilter(plain.filterId) : null
      const query = plain.queryId ? domain.getQuery(plain.queryId) : null
      const filterDoc = filter ? await repos.filters.findByIdentity((filter as any).identity ?? String(filter.id)) : null
      const queryDoc = query ? await repos.queries.findByIdentity((query as any).identity ?? String(query.id)) : null
      const saved = await repos.views.upsert({
        identity: plain.identity,
        displayName: plain.name,
        description: plain.description ?? undefined,
        isSystem: plain.isSystem,
        folder: folderId,
        component: compDoc?.id ?? comp?.id ?? null,
        filter: filterDoc?.id ?? null,
        query: queryDoc?.id ?? null,
        meta: (view.meta && typeof view.meta === 'object' && !Array.isArray(view.meta)) ? view.meta : {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'page-template') {
      const tpl = ((opts?.model as any) ?? domain.getPageTemplate(documentId)) as any
      if (!tpl)
        throw new Error(`Шаблон страницы не найден: ${documentId}`)
      const plain = tpl.toPlain()
      const pageTemplateIdentity = String((tpl as any).identity ?? plain.id ?? tpl.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.pageTemplates.findByIdentity(pageTemplateIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-page-templates')
        folderId = folderDoc?.id
      }
      const saved = await repos.pageTemplates.upsert({
        identity: pageTemplateIdentity,
        displayName: plain.name,
        description: plain.description ?? undefined,
        folder: folderId,
        isSystem: plain.isSystem,
        areas: plain.areas ?? [],
        preview: plain.preview ?? undefined,
        meta: plain.meta ?? {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'page') {
      const page = ((opts?.model as any) ?? domain.getPage(documentId)) as any
      if (!page)
        throw new Error(`Страница не найдена: ${documentId}`)
      const plain = page.toPlain()
      let folderId: number | string | undefined
      const existing = await repos.pages.findByIdentity(plain.identity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-pages')
        folderId = folderDoc?.id
      }

      const templateRef = (plain as any).templateId ?? (plain as any).templateIdentity ?? null
      let templatePayloadId: number | string
      if (templateRef != null && String(templateRef).trim() !== '') {
        const templateById = domain.getPageTemplateById(templateRef)
        const templateByIdentity = !templateById ? domain.getPageTemplate(String(templateRef)) : null
        const resolvedTemplate = templateById ?? templateByIdentity

        if (resolvedTemplate?.id != null) {
          templatePayloadId = resolvedTemplate.id
        }
        else if (typeof templateRef === 'number' && Number.isFinite(templateRef)) {
          templatePayloadId = templateRef
        }
        else if (typeof templateRef === 'string' && /^-?\d+$/.test(templateRef)) {
          templatePayloadId = Number(templateRef)
        }
        else {
          const tplDoc = await repos.pageTemplates.findByIdentity(String(templateRef))
          if (!tplDoc)
            throw new Error(`Шаблон страницы не найден в Payload: ${String(templateRef)}`)
          templatePayloadId = tplDoc.id
        }
      }
      else {
        throw new Error('[EndgeSchemaStorage.saveDocument] Для страницы не задан templateId')
      }
      let controllerPayloadId: number | string | null = null
      const controllerRef = (plain as any).controllerId ?? (plain as any).controllerIdentity ?? null
      if (controllerRef != null && String(controllerRef).trim() !== '') {
        const viewById = domain.getViewById(controllerRef)
        const viewByIdentity = !viewById ? domain.getView(String(controllerRef)) : null
        const resolvedController = viewById ?? viewByIdentity

        if (resolvedController?.id != null) {
          controllerPayloadId = resolvedController.id
        }
        else if (typeof controllerRef === 'number' && Number.isFinite(controllerRef)) {
          controllerPayloadId = controllerRef
        }
        else if (typeof controllerRef === 'string' && /^-?\d+$/.test(controllerRef)) {
          controllerPayloadId = Number(controllerRef)
        }
        else {
          const controllerDoc = await repos.views.findByIdentity(String(controllerRef))
          if (!controllerDoc)
            throw new Error(`Контроллер страницы (view) не найден в Payload: ${String(controllerRef)}`)
          controllerPayloadId = controllerDoc.id
        }
      }

      /** Маппинг entityType домена -> relationTo коллекции Payload (полиморфная связь). */
      const entityTypeToRelation: Record<string, string> = {
        component: 'components',
        filter: 'filters',
        view: 'views',
        query: 'queries',
        type: 'types',
        action: 'actions',
        converter: 'converters',
        integration: 'integrations',
        parameter: 'parameters',
        environment: 'environments',
        policy: 'policies',
        style: 'styles',
      }

      const areasForPayload: Array<{ slotId: string, blocks: Array<{ key: string, entity: { relationTo: string, value: number }, titleOverride?: string | null, visibleWhen?: string | null, props?: Record<string, unknown> | null }> }> = []
      for (const a of plain.areas ?? []) {
        const blocks: Array<{ key: string, entity: { relationTo: string, value: number }, titleOverride?: string | null, visibleWhen?: string | null, props?: Record<string, unknown> | null }> = []
        for (const b of a.blocks ?? []) {
          const relationTo = entityTypeToRelation[b.entityType ?? ''] ?? 'components'
          let docId: number | null = (b as any).entityId != null && Number.isFinite((b as any).entityId) ? Number((b as any).entityId) : null
          if (docId == null) {
            const identity = b.entityIdentity ?? ''
            if (b.entityType === 'component') {
              const doc = await repos.components.findByIdentity(identity)
              docId = (doc as any)?.id != null ? (doc as any).id : null
            }
            else if (b.entityType === 'filter') {
              const doc = await repos.filters.findByIdentity(identity)
              docId = (doc as any)?.id != null ? (doc as any).id : null
            }
            else if (relationTo === 'views') {
              const doc = await repos.views.findByIdentity(identity)
              docId = (doc as any)?.id != null ? (doc as any).id : null
            }
            else if (relationTo === 'queries') {
              const doc = await repos.queries.findByIdentity(identity)
              docId = (doc as any)?.id != null ? (doc as any).id : null
            }
          }
          if (docId == null)
            continue
          blocks.push({
            key: b.key,
            entity: { relationTo, value: docId },
            titleOverride: b.titleOverride ?? undefined,
            visibleWhen: b.visibleWhen ?? undefined,
            props: b.props ?? undefined,
          })
        }
        areasForPayload.push({ slotId: a.slotId, blocks })
      }

      const saved = await repos.pages.upsert({
        identity: plain.identity,
        displayName: plain.name,
        description: plain.description ?? undefined,
        folder: folderId,
        isSystem: plain.isSystem,
        routeName: plain.routeName ?? null,
        routePath: plain.routePath ?? null,
        template: templatePayloadId,
        controller: controllerPayloadId,
        enabled: plain.enabled ?? true,
        areas: areasForPayload,
        meta: plain.meta ?? {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'navigation') {
      const nav = ((opts?.model as any) ?? domain.getNavigation(documentId)) as any
      if (!nav)
        throw new Error(`Навигация не найдена: ${documentId}`)
      const plain = nav.toPlain()
      const navigationIdentity = String((nav as any).identity ?? plain.id ?? nav.id ?? '')
      let folderId: number | string | undefined
      const existing = await repos.navigations.findByIdentity(navigationIdentity)
      if (existing && ((existing as any).folderId ?? (existing as any).folder) != null) {
        folderId = (existing as any).folderId ?? (existing as any).folder
      }
      else {
        const folderDoc = await repos.folders.findByIdentity('root-navigations')
        folderId = folderDoc?.id
      }
      const saved = await repos.navigations.upsert({
        identity: navigationIdentity,
        displayName: plain.name,
        description: plain.description ?? undefined,
        folder: folderId,
        isSystem: plain.isSystem,
        tree: plain.tree ?? [],
        meta: plain.meta ?? {},
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    if (documentType === 'project') {
      const project = ((opts?.model as any) ?? domain.getProject(documentId)) as any
      if (!project)
        throw new Error(`Проект не найден: ${documentId}`)
      const plain = project.toPlain()
      const allowedEnvironments = relationToNumericIds(plain.allowedEnvironmentIds ?? plain.allowedEnvironments ?? [])
      const saved = await repos.projects.upsert({
        'identity': plain.identity,
        'displayName': plain.displayName ?? plain.name ?? plain.identity,
        'description': plain.description ?? undefined,
        'slug': plain.slug ?? undefined,
        'order': plain.order ?? undefined,
        'navigation': plain.navigationId ?? null,
        'allowedEnvironments': allowedEnvironments,
        'folder': plain.folderId ?? plain.folder ?? null,
        'deletedAt': plain.deletedAt ?? null,
      })
      this._applyPayloadDocToDomain(documentType, saved, documentId, true)
      return
    }

    throw new Error(
      `[EndgeSchemaStorage.saveDocument] Неподдерживаемый тип документа: ${documentType}`,
    )
  }

  /**
   * Меняет только папку документа в Payload. Данные берутся из домена (identity), запрос - один PATCH с полем folder.
   * Ответ PATCH парсится и вставляется в домен для реактивного обновления виджета.
   */
  public async changeDocumentFolder(
    documentId: string | number,
    documentType: DomainDocumentType,
    folderIdOrIdentity: string | number | null,
  ): Promise<void> {
    const repos = this.repositories
    if (!repos) {
      throw new Error(
        '[EndgeSchemaStorage.changeDocumentFolder] Репозитории не инициализированы. Вызови init().',
      )
    }
    let documentPayloadId = await this.resolveDocumentPayloadIdForFolderPatch(documentId, documentType)
    if (documentPayloadId == null) {
      throw new Error(
        '[EndgeSchemaStorage.changeDocumentFolder] Не удалось определить id документа для PATCH. Проверь, что документ уже создан в Payload.',
      )
    }
    const folderPayloadId = await this.resolveFolderPayloadId(folderIdOrIdentity)
    let doc: any = null
    try {
      doc = await this.patchDocumentFolderByPayloadId(documentType, documentPayloadId, folderPayloadId)
    }
    catch (err) {
      const refreshedPayloadId = await this.resolveDocumentPayloadIdForFolderPatch(documentId, documentType, { forceLookup: true })
      if (refreshedPayloadId == null || String(refreshedPayloadId) === String(documentPayloadId))
        throw err
      documentPayloadId = refreshedPayloadId
      doc = await this.patchDocumentFolderByPayloadId(documentType, documentPayloadId, folderPayloadId)
    }
    const payloadDoc = this._extractPayloadDoc(doc)
    const folderFromPayload = payloadDoc ? (relationToId((payloadDoc as any).folder) ?? folderPayloadId) : folderPayloadId
    const deletedAtFromPayload = payloadDoc && typeof payloadDoc === 'object' && 'deletedAt' in payloadDoc
      ? ((payloadDoc as any).deletedAt ?? null)
      : undefined
    this._updateDomainDocumentFolder(documentType, documentId, folderFromPayload, deletedAtFromPayload)
  }

  /**
   * Парсит ответ PATCH и вставляет документ в домен (merge) для реактивного обновления UI.
   * notifyDomainChanged — эмитить domainChanged в AppBus (при сохранении через репозиторий).
   */
  private _applyPayloadDocToDomain(
    documentType: DomainDocumentType,
    rawDoc: any,
    replaceRef?: string | number,
    notifyDomainChanged?: boolean,
  ): void {
    const payloadDoc = this._extractPayloadDoc(rawDoc)
    const plain = this._normalizePayloadDocToPlain(documentType, payloadDoc)
    if (!plain)
      return
    const key = this._getDumpKey(documentType)
    if (!key)
      return
    if (replaceRef != null)
      this._removeDomainDocumentByType(documentType, replaceRef)
    Endge.domain.merge({ [key]: [plain] })
    if (notifyDomainChanged) {
      (AppBus.emit as (event: string, payload?: unknown) => void)('domainChanged', undefined)
    }
  }

  /**
   * Нормализует ответ Payload до объекта документа.
   * POST/PATCH могут возвращать либо сам doc, либо обёртку с `doc`/`data.doc`.
   */
  private _extractPayloadDoc(raw: any): any {
    if (!raw || typeof raw !== 'object')
      return raw

    if ((raw as any).doc && typeof (raw as any).doc === 'object')
      return (raw as any).doc

    if ((raw as any).data && typeof (raw as any).data === 'object') {
      const data = (raw as any).data
      if (data.doc && typeof data.doc === 'object')
        return data.doc
      if (data.id != null || data.identity != null)
        return data
    }

    if (Array.isArray((raw as any).docs) && (raw as any).docs.length > 0)
      return (raw as any).docs[0]

    return raw
  }

  /**
   * Удаляет старый документ из доменных индексов перед вставкой обновлённого payload-документа.
   */
  private _removeDomainDocumentByType(
    documentType: DomainDocumentType,
    documentIdOrIdentity: string | number,
  ): void {
    const existing = this.getDomainDocumentByType(documentType, documentIdOrIdentity)
    if (!existing)
      return

    const id = (existing as any).id
    const identity = (existing as any).identity

    const removeBy = (
      removeById: (id: any) => void,
      removeByIdentity: (identity: string) => void,
    ) => {
      if (id != null) {
        removeById(id)
        return
      }
      if (identity != null)
        removeByIdentity(String(identity))
    }

    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      removeBy(
        x => Endge.domain.removeComponentById(x),
        x => Endge.domain.removeComponent(x),
      )
      return
    }
    if (documentType === ComponentType.SFC) {
      removeBy(
        x => Endge.domain.removeComponentSFCById(x),
        x => Endge.domain.removeComponentSFC(x),
      )
      return
    }
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom) {
      removeBy(
        x => Endge.domain.removeQueryById(x),
        x => Endge.domain.removeQuery(x),
      )
      return
    }
    if (documentType === 'data-view') {
      removeBy(
        x => Endge.domain.removeDataViewById(x),
        x => Endge.domain.removeDataView(x),
      )
      return
    }
    if (documentType === 'composition') {
      removeBy(
        x => Endge.domain.removeCompositionById(x),
        x => Endge.domain.removeComposition(x),
      )
      return
    }
    if (documentType === 'store') {
      removeBy(
        x => Endge.domain.removeStoreById(x),
        x => Endge.domain.removeStore(x),
      )
      return
    }
    if (documentType === 'mock') {
      removeBy(
        x => Endge.domain.removeMockById(x),
        x => Endge.domain.removeMock(x),
      )
      return
    }
    if (documentType === ParameterType.DefaultParameter) {
      removeBy(
        x => Endge.domain.removeParameterById(x),
        x => Endge.domain.removeParameter(x),
      )
      return
    }
    if (documentType === FilterType.DefaultFilter) {
      removeBy(
        x => Endge.domain.removeFilterById(x),
        x => Endge.domain.removeFilter(x),
      )
      return
    }
    if (documentType === 'type' || documentType === 'primitive') {
      removeBy(
        x => Endge.domain.removeTypeById(x),
        x => Endge.domain.removeType(x),
      )
      return
    }
    if (documentType === 'action') {
      removeBy(
        x => Endge.domain.removeActionById(x),
        x => Endge.domain.removeAction(x),
      )
      return
    }
    if (documentType === 'converter') {
      removeBy(
        x => Endge.domain.removeConverterById(x),
        x => Endge.domain.removeConverter(x),
      )
      return
    }
    if (documentType === 'integration') {
      removeBy(
        x => Endge.domain.removeIntegrationById(x),
        x => Endge.domain.removeIntegration(x),
      )
      return
    }
    if (documentType === 'view') {
      removeBy(
        x => Endge.domain.removeViewById(x),
        x => Endge.domain.removeView(x),
      )
      return
    }
    if (documentType === 'environment') {
      removeBy(
        x => Endge.domain.removeEnvironmentById(x),
        x => Endge.domain.removeEnvironment(x),
      )
      return
    }
    if (documentType === 'tenant') {
      removeBy(
        x => Endge.domain.removeTenantById(x),
        x => Endge.domain.removeTenant(x),
      )
      return
    }
    if (documentType === 'behavior-binding') {
      removeBy(
        x => Endge.domain.removeBehaviorBindingById(x),
        x => Endge.domain.removeBehaviorBinding(x),
      )
      return
    }
    if (documentType === 'presentation-binding') {
      removeBy(
        x => Endge.domain.removePresentationBindingById(x),
        x => Endge.domain.removePresentationBinding(x),
      )
      return
    }
    if (documentType === 'policy') {
      removeBy(
        x => Endge.domain.removePolicyById(x),
        x => Endge.domain.removePolicy(x),
      )
      return
    }
    if (documentType === 'style') {
      removeBy(
        x => Endge.domain.removeStyleById(x),
        x => Endge.domain.removeStyle(x),
      )
      return
    }
    if (documentType === 'page-template') {
      removeBy(
        x => Endge.domain.removePageTemplateById(x),
        x => Endge.domain.removePageTemplate(x),
      )
      return
    }
    if (documentType === 'page') {
      removeBy(
        x => Endge.domain.removePageById(x),
        x => Endge.domain.removePage(x),
      )
      return
    }
    if (documentType === 'navigation') {
      removeBy(
        x => Endge.domain.removeNavigationById(x),
        x => Endge.domain.removeNavigation(x),
      )
      return
    }
    if (documentType === 'vocabs') {
      removeBy(
        x => Endge.domain.removeVocabsById(x),
        x => Endge.domain.removeVocabs(x),
      )
    }
    if (documentType === 'auth-profile') {
      removeBy(
        x => Endge.domain.removeAuthProfileById(x),
        x => Endge.domain.removeAuthProfile(x),
      )
    }
    if (documentType === 'i18n-bundles') {
      removeBy(
        x => Endge.domain.removeI18nBundlesById(x),
        x => Endge.domain.removeI18nBundles(x),
      )
    }
  }

  /**
   * Локально обновляет только папку документа (и related-поля), затем шлёт notify.
   */
  private _updateDomainDocumentFolder(
    documentType: DomainDocumentType,
    documentIdOrIdentity: string | number,
    folderId: string | number | null,
    deletedAt?: string | null,
  ): void {
    const doc
      = this.getDomainDocumentByType(documentType, documentIdOrIdentity)
        ?? this.getDomainDocumentByType(documentType, this.resolveDocumentIdentity(documentIdOrIdentity, documentType))
    if (!doc)
      return

    const mutable = doc as any
    mutable.folderId = folderId ?? null
    if (documentType === ComponentType.Table || documentType === ComponentType.DSL)
      mutable.group = folderId ?? null
    if (deletedAt !== undefined)
      mutable.deletedAt = deletedAt

    Endge.domain.notify()
  }

  /**
   * Возвращает Dump Key.
   */
  private _getDumpKey(documentType: DomainDocumentType): keyof EndgeSchemaDump | '' {
    if (documentType === ComponentType.Table || documentType === ComponentType.DSL)
      return 'components'
    if (documentType === ComponentType.SFC)
      return 'componentSFCs'
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom)
      return 'queries'
    if (documentType === 'data-view')
      return 'dataViews'
    if (documentType === 'composition')
      return 'compositions'
    if (documentType === 'store')
      return 'stores'
    if (documentType === 'mock')
      return 'mocks'
    if (documentType === ParameterType.DefaultParameter)
      return 'parameters'
    if (documentType === FilterType.DefaultFilter)
      return 'filters'
    if (documentType === 'type' || documentType === 'primitive')
      return 'types'
    if (documentType === 'action')
      return 'actions'
    if (documentType === 'converter')
      return 'converters'
    if (documentType === 'integration')
      return 'integrations'
    if (documentType === 'view')
      return 'views'
    if (documentType === 'environment')
      return 'environments'
    if (documentType === 'tenant')
      return 'tenants'
    if (documentType === 'behavior-binding')
      return 'behaviorBindings'
    if (documentType === 'presentation-binding')
      return 'presentationBindings'
    if (documentType === 'policy')
      return 'policies'
    if (documentType === 'style')
      return 'styles'
    if (documentType === 'page-template')
      return 'pageTemplates'
    if (documentType === 'page')
      return 'pages'
    if (documentType === 'navigation')
      return 'navigations'
    if (documentType === 'vocabs')
      return 'vocabs'
    if (documentType === 'auth-profile')
      return 'authProfiles'
    if (documentType === 'i18n-bundles')
      return 'i18nBundles'
    return ''
  }

  /**
   * Нормализует Payload Doc To Plain.
   */
  private _normalizePayloadDocToPlain(documentType: DomainDocumentType, raw: any): any {
    if (documentType === QueryType.REST || documentType === QueryType.GraphQL || documentType === QueryType.Custom)
      return queryPayloadDocToPlain(raw)
    if (documentType === 'data-view')
      return dataViewPayloadDocToPlain(raw)
    if (documentType === 'composition')
      return compositionPayloadDocToPlain(raw)
    if (documentType === 'store')
      return storePayloadDocToPlain(raw)
    if (documentType === 'mock')
      return mockPayloadDocToPlain(raw)
    if (documentType === ParameterType.DefaultParameter) {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        folderId: relationToId(raw.folder) ?? null,
        author: raw.author ?? null,
        active: raw.active ?? true,
        deletedAt: raw.deletedAt ?? null,
        fields: raw.fields ?? [],
        runtimeFilters: (raw as any).runtimeFilters ?? [],
      }
    }
    if (documentType === FilterType.DefaultFilter) {
      const fields = (raw.fields ?? []).map((f: any) => ({
        ...f,
        active: f.active !== false,
        multiple: f.multiple !== false,
        converterIdentities: Array.isArray(f.converterIdentities) ? f.converterIdentities.map((c: any) => (typeof c === 'string' ? c : c?.identity)).filter(Boolean) : [],
      }))
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        folderId: relationToId(raw.folder) ?? null,
        author: raw.author ?? null,
        active: raw.active ?? true,
        deletedAt: raw.deletedAt ?? null,
        fields,
        source: String(raw.source ?? ''),
        sourceVersion: Number(raw.sourceVersion ?? 1) || 1,
      }
    }
    if (documentType === 'type' || documentType === 'primitive') {
      const schema = raw.schema ?? {}
      const id = schema.id ?? (raw.id != null ? String(raw.id) : undefined)
      return {
        ...schema,
        id,
        identity: schema.identity ?? raw.identity,
        name: schema.name ?? raw.displayName,
        folderId: relationToId(raw.folder) ?? schema.folderId ?? schema.folder ?? null,
        isPrimitive: schema.isPrimitive === true || raw.isPrimitive === true,
        isSystem: raw.isSystem === true,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : (schema.meta ?? {}),
      }
    }
    if (documentType === 'action') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        definition: normalizeFlowDefinition(raw.definition),
        input: normalizeActionField(raw.input, 'input'),
        output: normalizeActionField(raw.output, 'output'),
      }
    }
    if (documentType === 'converter' || documentType === 'integration' || documentType === 'view') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
      }
    }
    if (documentType === 'environment') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
      }
    }
    if (documentType === 'tenant') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        code: raw.code ?? raw.identity ?? '',
        description: raw.description ?? null,
        folderId: relationToId(raw.folder) ?? null,
      }
    }
    if (documentType === 'behavior-binding') {
      const modeText = String(raw.mode ?? 'replace').trim().toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable' ? modeText : 'replace'
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        projectId: relationToNumericId(raw.projectId) ?? null,
        ownerType: String(raw.ownerType ?? '').trim(),
        ownerId: relationToNumericId(raw.ownerId) ?? null,
        targetType: String(raw.targetType ?? '').trim(),
        targetId: relationToNumericId(raw.targetId) ?? null,
        eventName: String(raw.eventName ?? '').trim(),
        scriptRef: String(raw.scriptRef ?? '').trim(),
        mode,
        priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
        isEnabled: raw.isEnabled !== false,
        environmentId: relationToNumericId(raw.environmentId) ?? null,
        isInherited: raw.isInherited === true,
        originBindingId: relationToNumericId(raw.originBindingId) ?? null,
        folderId: relationToId(raw.folder) ?? null,
      }
    }
    if (documentType === 'presentation-binding') {
      const modeText = String(raw.mode ?? 'replace').trim().toLowerCase()
      const mode = modeText === 'append' || modeText === 'prepend' || modeText === 'disable' ? modeText : 'replace'
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        projectId: relationToNumericId(raw.projectId) ?? null,
        ownerType: String(raw.ownerType ?? '').trim(),
        ownerId: relationToNumericId(raw.ownerId) ?? null,
        targetType: String(raw.targetType ?? '').trim(),
        targetId: relationToNumericId(raw.targetId) ?? null,
        role: String(raw.role ?? '').trim(),
        rendererRef: String(raw.rendererRef ?? '').trim(),
        when: raw.when == null ? null : String(raw.when).trim(),
        mode,
        priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
        isEnabled: raw.isEnabled !== false,
        environmentId: relationToNumericId(raw.environmentId) ?? null,
        isInherited: raw.isInherited === true,
        originBindingId: relationToNumericId(raw.originBindingId) ?? null,
        folderId: relationToId(raw.folder) ?? null,
      }
    }
    if (documentType === 'policy') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        folderId: relationToId(raw.folder) ?? null,
      }
    }
    if (documentType === 'style') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        styles: (raw.styles && typeof raw.styles === 'object' && !Array.isArray(raw.styles)) ? raw.styles : {},
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
        inherited: raw.inherited === true,
        isSystem: raw.isSystem === true,
      }
    }
    if (documentType === 'navigation') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        description: raw.description ?? null,
        isSystem: raw.isSystem === true,
        folderId: relationToId(raw.folder) ?? null,
        project: relationToId(raw.project) ?? null,
        tree: Array.isArray(raw.tree) ? raw.tree : [],
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }
    if (documentType === 'vocabs') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        mode: raw.mode === 'internal' ? 'internal' : 'external_payload',
        baseApiUrl: raw.baseApiUrl ?? null,
        collectionSlug: raw.collectionSlug ?? null,
        authMode: raw.authMode ?? 'inherit',
        authProfileIdentity: raw.authProfileIdentity ?? null,
        folderId: relationToId(raw.folder) ?? null,
        active: raw.active !== false,
        deletedAt: raw.deletedAt ?? null,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }
    if (documentType === 'auth-profile') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        adapterId: raw.adapterId ?? 'manual_token',
        config: (raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)) ? raw.config : {},
        credentialRefs: (raw.credentialRefs && typeof raw.credentialRefs === 'object' && !Array.isArray(raw.credentialRefs)) ? raw.credentialRefs : {},
        persist: raw.persist ?? 'localStorage',
        folderId: relationToId(raw.folder) ?? null,
        active: raw.active !== false,
        deletedAt: raw.deletedAt ?? null,
        meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      }
    }
    if (documentType === 'i18n-bundles') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        description: raw.description ?? null,
        locales: (raw.locales && typeof raw.locales === 'object' && !Array.isArray(raw.locales)) ? raw.locales : {},
        folderId: relationToId(raw.folder) ?? null,
        active: raw.active !== false,
        deletedAt: raw.deletedAt ?? null,
      }
    }
    if (documentType === 'project') {
      return {
        id: raw.id,
        identity: raw.identity,
        name: raw.displayName,
        displayName: raw.displayName,
        folderId: relationToId(raw.folder) ?? null,
        deletedAt: raw.deletedAt ?? null,
        description: raw.description ?? null,
        slug: raw.slug ?? null,
        order: raw.order != null ? Number(raw.order) : null,
        navigationId: relationToId(raw.navigation) ?? null,
        allowedEnvironmentIds: relationToNumericIds(raw.allowedEnvironments ?? raw.allowedEnvironmentIds ?? []),
      }
    }
    if (documentType === ComponentType.Table || documentType === ComponentType.DSL) {
      return this._normalizeComponentPayloadDoc(raw)
    }
    if (documentType === ComponentType.SFC) {
      return this._normalizeComponentSFCPayloadDoc(raw)
    }
    return null
  }

  /**
   * Нормализует Component SFCPayload Doc.
   */
  private _normalizeComponentSFCPayloadDoc(raw: any): any {
    return {
      id: raw.id,
      identity: raw.identity ?? '',
      name: raw.displayName ?? raw.identity ?? '',
      displayName: raw.displayName ?? raw.identity ?? '',
      description: raw.description ?? null,
      folderId: relationToId(raw.folder) ?? null,
      project: relationToId(raw.project) ?? null,
      kind: 'component-sfc',
      type: ComponentType.SFC,
      sourceKind: 'component-sfc',
      source: typeof raw.source === 'string' ? raw.source : '',
      supportedTargets: normalizeComponentSFCTargets(raw.supportedTargets),
      modelVersion: Number(raw.modelVersion ?? 1),
      meta: (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? raw.meta : {},
      active: raw.active ?? true,
      deletedAt: raw.deletedAt ?? null,
      author: raw.author ?? null,
      inherited: raw.inherited === true,
    }
  }

  /**
   * Нормализует Component Payload Doc.
   */
  private _normalizeComponentPayloadDoc(raw: any): any {
    const name = raw.displayName
    const type = raw.componentType ?? 'component-dsl'
    const inputFields = Array.isArray(raw.inputFields) ? raw.inputFields : []
    const inputs: Record<string, any> = {}
    for (const f of inputFields) {
      const key = f?.name
      if (!key)
        continue
      const params = Array.isArray(f.params) ? f.params : []
      inputs[key] = {
        name: key,
        type: f?.type ?? '',
        isArray: f?.isArray === true,
        optional: f?.optional === true,
        params: params.map((p: any) => ({ name: p?.name ?? '', type: p?.type ?? '' })),
      }
    }
    const base: Record<string, any> = {
      id: raw.id,
      identity: raw.identity ?? (raw.id != null ? String(raw.id) : undefined),
      name,
      type,
      inputs,
      runtimeFilters: Array.isArray(raw.runtimeFilters) ? raw.runtimeFilters.map((x: any) => (typeof x === 'object' && x?.value != null ? x.value : String(x))) : [],
      folderId: relationToId(raw.folder) ?? null,
    }
    if (type === 'component-dsl') {
      return { ...base, jsxScript: raw.jsxScript ?? '' }
    }
    if (type === 'component-table') {
      const bindingsKeys: Record<string, { pk: string, fk: string }> = {}
      for (const k of Array.isArray(raw.bindings?.keys) ? raw.bindings.keys : []) {
        const varName = k?.varName
        if (!varName)
          continue
        bindingsKeys[varName] = { pk: typeof k?.pk === 'string' ? k.pk : '', fk: typeof k?.fk === 'string' ? k.fk : '' }
      }
      const columns = (Array.isArray(raw.columns) ? raw.columns : []).map((col: any) => {
        const src = (
          col
          && typeof col === 'object'
          && col.value
          && col.id === undefined
          && col.title === undefined
        )
          ? col.value
          : col
        return {
          id: src?.id ?? src?.identity ?? src?.key,
          key: src?.key ?? src?.identity ?? '',
          label: src?.label ?? '',
          title: src?.title ?? src?.label ?? '',
          dataPath: src?.dataPath ?? '',
          dataPaths: (src?.dataPaths && typeof src.dataPaths === 'object') ? src.dataPaths : {},
          dataConverters: Array.isArray(src?.dataConverters) ? src.dataConverters : [],
          componentId: relationToNumericId(src?.component) ?? relationToNumericId(src?.componentId),
          width: src?.width ?? 150,
          isActive: src?.isActive !== false,
          type: src?.type ?? 'component',
          reports: src?.reports && typeof src.reports === 'object' ? src.reports : null,
          template: src?.template ?? null,
        }
      })
      return {
        ...base,
        sourceIndex: raw.sourceIndex ?? '',
        rowSize: raw.rowSize ?? 40,
        bindings: { keys: bindingsKeys },
        columns,
      }
    }
    return base
  }

  /**
   * Утилита для добавления ошибки с timestamp.
   * Возвращает созданный объект ошибки, чтобы его можно было
   * положить ещё и в коллекционную структуру.
   */
  private pushError(err: Omit<EndgeSchemaError, 'at'>): EndgeSchemaError {
    const full: EndgeSchemaError = {
      ...err,
      at: new Date().toISOString(),
    }
    this._errors.push(full)
    return full
  }

  /**
   * Приводим ошибку к компактному JSON, чтобы её можно было
   * безболезненно сохранить/логировать/показывать в UI.
   */
  private normalizeError(e: unknown): any {
    if (axios.isAxiosError(e)) {
      const ax = e as AxiosError<any>
      return {
        message: ax.message,
        code: ax.code,
        status: ax.response?.status,
        data: ax.response?.data,
        url: ax.config?.url,
        method: ax.config?.method,
      }
    }

    if (e instanceof Error) {
      return {
        message: e.message,
        name: e.name,
        stack: e.stack,
      }
    }

    return e
  }

  /**
   * Удобный toJSON - можно сразу складывать в лог/стейт.
   */
  public toJSON(): any {
    return {
      isHealthy: this.isHealthy,
      isPayloadAvailable: this.isPayloadAvailable,
      areCollectionsAvailable: this.areCollectionsAvailable,
      errors: this._errors,
      collectionsInfo: this.collectionsInfo,
    }
  }
}
