import type { ProgramArtifact, QueryProgramOutput } from '@/domain/types/program/program.types'

import type {
  VocabCacheOperationResult,
  VocabLoadPolicy,
  VocabReference,
} from '@/domain/types/runtime/vocab-cache.types'
import type { VocabMockReference, VocabPayloadProvider, VocabProgramPayload } from '@/domain/types/source/vocab-source.types'
import { Raph } from '@endge/raph'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { DEFAULT_VOCAB_LOAD_POLICY } from '@/domain/types/runtime/vocab-cache.types'
import { Endge } from '@/model/kernel/endge'
import { runResponseOutputTransforms } from '@/model/modules/runtime/execution/endge-response-output'

interface VocabRuntimeConfig {
  idKey: string
  identity: string
  baseApiUrl: string
  slug: string
  authMode: 'inherit' | 'profile' | 'none'
  authProfileIdentity?: string | null
  provider: VocabPayloadProvider | null
  mock: VocabMockReference | null
  outputs: QueryProgramOutput[]
  artifact: ProgramArtifact<VocabProgramPayload> | null
}

const MISSING_PATH = Symbol('missing-vocab-mock-path')

function selectDotPath(source: unknown, path: string): unknown | typeof MISSING_PATH {
  let current: unknown = source
  for (const segment of path.split('.')) {
    if (current == null || (typeof current !== 'object' && !Array.isArray(current))) {
      return MISSING_PATH
    }
    if (!Object.hasOwn(current, segment)) {
      return MISSING_PATH
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function selectPath(source: unknown, path: string | null): unknown {
  if (!path) {
    return source
  }
  const selected = selectDotPath(source, path)
  return selected === MISSING_PATH ? undefined : selected
}

export interface VocabAcquireOptions {
  dataMode?: 'live' | 'mock'
}
/**
 * Модуль загрузки и чтения external vocabs в Raph cache.
 */
export class EndgeVocabs_Module extends EndgeModule {
  /**
   * slug -> namespace
   * Можно оставить для getNamespaceValues (чтобы понимать какие slugs в пространстве)
   */
  private _index: Record<string, string> = {}
  private _byIdCache: Record<string, any[]> = {}
  private readonly _loadedIdentities = new Set<string>()
  private readonly _loadedAtByIdentity = new Map<string, number>()
  private readonly _loadedModeByIdentity = new Map<string, 'live' | 'mock'>()
  private readonly _inFlight = new Map<string, Promise<any[]>>()
  private readonly _cacheVersions = new Map<string, number>()
  private _loadingRequests: number = 0
  public loading: boolean = false

  /**
   * Строит индекс collectionSlug -> vocab identity из доменных документов vocabs.
   */
  public init(): void {
    const nextIndex: Record<string, string> = {}

    for (const artifact of Endge.program.getArtifacts().filter(item => item.ref.entityType === 'vocab')) {
      const identity = String(artifact.ref.identity ?? '').trim()
      const slug = String((artifact as ProgramArtifact<VocabProgramPayload>).payload.provider?.collection ?? '').trim()
      if (!identity || !slug) {
        continue
      }

      if (typeof nextIndex[slug] === 'undefined') {
        nextIndex[slug] = identity
      }
    }

    this._index = nextIndex
  }

  /**
   * Загружает словарь по identity или collectionSlug.
   * Namespace резолвится через доменный документ справочника.
   */
  public async loadNamespace(namespace: string): Promise<void> {
    const ns: string = String(namespace ?? '').trim()
    if (!ns) {
      return
    }

    const cfg = this._resolveVocabConfigByIdentityOrSlug(ns, ns)
    if (!cfg) {
      console.warn(`Vocab с identity или collectionSlug="${ns}" не найден`)
      return
    }

    const base = this._resolveBaseUrl(cfg.baseApiUrl)
    if (!base) {
      return
    }

    const headers = await this._resolveAuthHeaders(cfg)

    try {
      const res = await fetch(`${base}/${cfg.slug}?limit=10000`, { headers })
      const json = await res.json()
      const docs = this._extractDocs(json)

      this._setCache(cfg, docs)
      this._markLoaded(cfg.identity)
    }
    catch (e: any) {
      const msg = e?.message ?? String(e)
      console.warn(`Ошибка при загрузке "${cfg.identity}/${cfg.slug}": ${msg}`)
    }
  }

  /**
   * Возвращает значения всех collections namespace или конкретного collection slug.
   */
  public getNamespaceValues(namespace: string, vocabs: string | null = null): Array<any> {
    const ns: string = String(namespace ?? '').trim()
    if (!ns) {
      return []
    }

    if (vocabs != null) {
      return this.getVocabsValues(ns, vocabs)
    }

    const cfg = this._resolveVocabConfigByIdentityOrSlug(ns, ns)
    if (!cfg) {
      return []
    }

    return this.getVocabsValues(ns, cfg.slug)
  }

  /**
   * По сигнатуре namespace остаётся, но фактически не используется для чтения,
   * потому что в Raph ключ теперь без namespace.
   */
  public getVocabsValues(namespace: string, vocabs: string): Array<any> {
    void namespace
    const vb: string = String(vocabs ?? '').trim()
    if (!vb) {
      return []
    }

    const cfg = this._resolveVocabConfigByIdentityOrSlug(vb, vb)
    const data = cfg ? this._getCache(cfg) : Raph.get(`vocabs.${vb}`)
    return Array.isArray(data) ? data : []
  }

  /**
   * Получение значений словаря без namespace:
   * просто `vocabs.<slug>`
   *
   * Индекс больше не обязателен для чтения - оставлен только для других сценариев.
   */
  public getValues(vocabs: string): Array<any> {
    const vb: string = String(vocabs ?? '').trim()
    if (!vb) {
      return []
    }

    const cfg = this._resolveVocabConfigByIdentityOrSlug(vb, vb)
    const data = cfg ? this._getCache(cfg) : Raph.get(`vocabs.${vb}`)
    return Array.isArray(data) ? data : []
  }

  /**
   * Загружает до limit сущностей словаря по API (для инспектора и превью).
   * Если данные уже в Raph - не дергает сеть.
   * @param vocabIdentity identity документа vocabs. Для legacy вызовов допускается старый namespace,
   * тогда словарь ищется по collectionSlug.
   * @param collectionSlug имя коллекции (name)
   * @param limit максимум документов (по умолчанию 1)
   */
  public async getSample(vocabIdentity: string, collectionSlug: string, limit: number = 1): Promise<any[]> {
    const ns = String(vocabIdentity ?? '').trim()
    const slug = String(collectionSlug ?? '').trim()
    if (!ns || !slug) {
      return []
    }

    const cachedCfg = this._resolveVocabConfigByIdentityOrSlug(ns, slug)
    const cached = cachedCfg ? this._getCache(cachedCfg) : Raph.get(`vocabs.${slug}`)
    if (Array.isArray(cached) && cached.length > 0) {
      return cached.slice(0, limit)
    }

    const cfg = this._resolveVocabConfigByIdentityOrSlug(ns, slug)
    if (!cfg) {
      return []
    }

    const base = this._resolveBaseUrl(cfg.baseApiUrl)
    if (!base) {
      return []
    }

    const headers = await this._resolveAuthHeaders(cfg)

    try {
      const url = `${base}/${cfg.slug}?limit=${Math.max(1, limit)}`
      const res = await fetch(url, { headers })
      const json = await res.json()
      const docs = this._extractDocs(json)
      return docs.slice(0, limit)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.getSample] ${cfg.identity}/${cfg.slug}: ${e instanceof Error ? e.message : String(e)}`)
      return []
    }
  }

  /**
   * Возвращает значения словаря по id, используя Raph cache и локальный fallback cache.
   */
  public getValuesById(vocabId: string | number): Array<any> {
    const cfg = this._resolveVocabConfigById(vocabId)
    if (!cfg) {
      return []
    }

    const byIdData = Raph.get(`vocabsByIdentity.${cfg.identity}`)
    if (Array.isArray(byIdData)) {
      return byIdData
    }

    const fallback = this._byIdCache[cfg.identity]
    if (Array.isArray(fallback)) {
      return fallback
    }

    const bySlug = this._getCache(cfg)
    if (!Array.isArray(bySlug)) {
      return []
    }

    this._setByIdentityCache(cfg.identity, bySlug)
    return bySlug
  }

  /**
   * Проверяет, есть ли загруженные значения словаря по id.
   */
  public hasCacheById(vocabId: string | number): boolean {
    return this.getValuesById(vocabId).length > 0
  }

  /**
   * Очищает cache словаря по id.
   */
  public clearCacheById(vocabId: string | number): void {
    const cfg = this._resolveVocabConfigByIdOrIdentity(vocabId)
    if (!cfg) {
      return
    }

    this._bumpCacheVersion(cfg.identity)
    this._loadedIdentities.delete(cfg.identity)
    this._loadedAtByIdentity.delete(cfg.identity)
    this._loadedModeByIdentity.delete(cfg.identity)
    delete this._byIdCache[cfg.identity]
    Raph.delete(`vocabsByIdentity.${cfg.identity}`)
    Raph.delete(`vocabs.${cfg.identity}`)
    if (cfg.slug) {
      Raph.delete(`vocabs.${cfg.slug}`)
    }
  }

  /**
   * Загружает отсутствующие справочники параллельно и переиспользует cache.
   */
  public async acquire(
    vocabs: readonly VocabReference[],
    policy: Partial<VocabLoadPolicy> = {},
    options: VocabAcquireOptions = {},
  ): Promise<VocabCacheOperationResult[]> {
    const effectivePolicy = this._normalizePolicy(policy)
    const dataMode = options.dataMode ?? 'live'
    return await Promise.all(this._normalizeReferences(vocabs).map(async (reference) => {
      const cfg = this._requireVocabConfig(reference)
      const cached = this._getCache(cfg)
      const hasCache = this._loadedModeByIdentity.get(cfg.identity) === dataMode && Array.isArray(cached)
      const isFresh = hasCache && this._isFresh(cfg.identity, effectivePolicy.maxAgeMs)

      if (effectivePolicy.strategy === 'cache-first' && isFresh) {
        return {
          identity: cfg.identity,
          status: 'cache-hit',
          count: cached.length,
        }
      }

      if (effectivePolicy.strategy === 'stale-while-revalidate' && hasCache) {
        if (isFresh) {
          return {
            identity: cfg.identity,
            status: 'cache-hit',
            count: cached.length,
          }
        }
        void this._loadShared(cfg, true, dataMode).catch((error: any) => {
          console.warn(`[EndgeVocabs.acquire] background refresh ${cfg.identity}: ${error instanceof Error ? error.message : String(error)}`)
        })
        return {
          identity: cfg.identity,
          status: 'refreshing',
          count: cached.length,
        }
      }

      try {
        const docs = await this._loadShared(cfg, hasCache || effectivePolicy.strategy === 'network-first', dataMode)
        return {
          identity: cfg.identity,
          status: hasCache ? 'refreshed' : 'loaded',
          count: docs.length,
        }
      }
      catch (error) {
        const fallback = this._getCache(cfg)
        if (effectivePolicy.onError === 'use-cache' && Array.isArray(fallback)) {
          return {
            identity: cfg.identity,
            status: 'cache-hit',
            count: fallback.length,
          }
        }
        throw error
      }
    }))
  }

  /**
   * Принудительно обновляет справочники параллельно, сохраняя дедупликацию одновременных запросов.
   */
  public async refresh(vocabs: readonly VocabReference[]): Promise<VocabCacheOperationResult[]> {
    return await Promise.all(this._normalizeReferences(vocabs).map(async (reference) => {
      const cfg = this._requireVocabConfig(reference)
      const docs = await this._loadShared(cfg, true)
      return {
        identity: cfg.identity,
        status: 'refreshed',
        count: docs.length,
      }
    }))
  }

  /**
   * Удаляет справочники только из runtime cache, не выполняя сетевых запросов.
   */
  public invalidate(vocabs: readonly VocabReference[]): VocabCacheOperationResult[] {
    return this._normalizeReferences(vocabs).map((reference) => {
      const cfg = this._requireVocabConfig(reference)
      const cached = this._getCache(cfg)
      const count = Array.isArray(cached) ? cached.length : 0
      this.clearCacheById(reference)
      return {
        identity: cfg.identity,
        status: 'invalidated',
        count,
      }
    })
  }

  /**
   * Загружает словарь по id и кладет результат в Raph cache.
   */
  public async loadById(vocabId: string | number, limit: number = 10000): Promise<void> {
    const cfg = this._resolveVocabConfigById(vocabId)
    if (!cfg) {
      return
    }
    const headers = await this._resolveAuthHeaders(cfg)

    const maxLimit = Math.max(1, Number(limit) || 10000)
    const baseUrl = this._resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl) {
      return
    }

    const url = `${baseUrl}/${cfg.slug}?limit=${maxLimit}`
    try {
      const res = await fetch(url, { headers })
      const json = await res.json()
      const docs = this._extractDocs(json)
      this._setCache(cfg, docs)
      this._markLoaded(cfg.identity)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.loadById] ${cfg.idKey}/${cfg.slug}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /**
   * Возвращает sample словаря по id, используя cache или сетевую загрузку.
   */
  public async getSampleById(vocabId: string | number, limit: number = 1): Promise<any[]> {
    const maxLimit = Math.max(1, Number(limit) || 1)
    const cfg = this._resolveVocabConfigById(vocabId)
    if (!cfg) {
      return []
    }

    const byIdCached = this.getValuesById(vocabId)
    if (byIdCached.length > 0) {
      return byIdCached.slice(0, maxLimit)
    }

    const bySlugCached = this._getCache(cfg)
    if (Array.isArray(bySlugCached) && bySlugCached.length > 0) {
      this._setByIdentityCache(cfg.identity, bySlugCached)
      return bySlugCached.slice(0, maxLimit)
    }

    const headers = await this._resolveAuthHeaders(cfg)

    const baseUrl = this._resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl) {
      return []
    }

    try {
      const url = `${baseUrl}/${cfg.slug}?limit=${maxLimit}`
      const res = await fetch(url, { headers })
      const json = await res.json()
      const docs = this._extractDocs(json)
      this._setCache(cfg, docs)
      return docs.slice(0, maxLimit)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.getSampleById] ${cfg.idKey}/${cfg.slug}: ${e instanceof Error ? e.message : String(e)}`)
      return []
    }
  }

  /**
   * Полностью загружает словарь по id или identity с постраничным обходом.
   */
  public async loadVocab(
    idOrIdentity: string | number,
    options: { throwOnError?: boolean, dataMode?: 'live' | 'mock' } = {},
  ): Promise<any[]> {
    const cfg = this._resolveVocabConfigByIdOrIdentity(idOrIdentity)
    if (!cfg) {
      if (options.throwOnError) {
        throw new Error(`Vocab "${String(idOrIdentity)}" не найден.`)
      }
      return []
    }
    this._setLoadingState(true)
    try {
      const raw = options.dataMode === 'mock'
        ? this._resolveMockValue(cfg)
        : await this.loadRawVocab(cfg.identity, { throwOnError: true })
      const items = this._applyOutputs(cfg, raw)
      this._setCache(cfg, items)
      this._markLoaded(cfg.identity, options.dataMode ?? 'live')
      return items
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.loadVocab] ${cfg.idKey}/${cfg.slug}: ${e instanceof Error ? e.message : String(e)}`)
      if (options.throwOnError) {
        throw e
      }
      return []
    }
    finally {
      this._setLoadingState(false)
    }
  }

  /** Загружает raw Payload без output pipeline; используется authoring preview и Mock generator. */
  public async loadRawVocab(
    idOrIdentity: string | number,
    options: { limit?: number, throwOnError?: boolean } = {},
  ): Promise<unknown> {
    const cfg = this._resolveVocabConfigByIdOrIdentity(idOrIdentity)
    if (!cfg) {
      if (options.throwOnError) {
        throw new Error(`Vocab "${String(idOrIdentity)}" не найден.`)
      }
      return []
    }
    if (!cfg.provider) {
      if (options.throwOnError) {
        throw new Error(`Vocab "${cfg.identity}" не содержит Payload provider.`)
      }
      return []
    }
    const baseUrl = this._resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl) {
      if (options.throwOnError) {
        throw new Error(`Vocab "${cfg.identity}" не содержит доступный provider.baseUrl.`)
      }
      return []
    }

    const headers = await this._resolveAuthHeaders(cfg)
    const requestedLimit = options.limit == null ? null : Math.max(1, Math.floor(options.limit))
    const pageSize = requestedLimit == null ? 1000 : Math.min(1000, requestedLimit)
    const allDocs: unknown[] = []
    let page = 1
    try {
      while (true) {
        const url = `${baseUrl}/${cfg.slug}?limit=${pageSize}&page=${page}`
        const response = await fetch(url, { headers })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
        }
        const json = await response.json()
        const docs = this._extractDocs(json)
        allDocs.push(...docs)
        if (requestedLimit != null && allDocs.length >= requestedLimit) {
          return allDocs.slice(0, requestedLimit)
        }
        if (!docs.length) {
          break
        }
        const nextPage = Number((json as any)?.nextPage ?? 0)
        const totalPages = Number((json as any)?.totalPages ?? 0)
        if (Boolean((json as any)?.hasNextPage) && nextPage > page) {
          page = nextPage
          continue
        }
        if (totalPages > page) {
          page += 1
          continue
        }
        if (Array.isArray(json) || docs.length < pageSize) {
          break
        }
        page += 1
      }
      return allDocs
    }
    catch (error) {
      if (options.throwOnError) {
        throw error
      }
      console.warn(`[EndgeVocabs.loadRawVocab] ${cfg.identity}: ${error instanceof Error ? error.message : String(error)}`)
      return []
    }
  }

  /** Применяет pipeline source-outputs и проверяет обязательный массив items. */
  private _applyOutputs(cfg: VocabRuntimeConfig, raw: unknown): any[] {
    const values: Record<string, unknown> = {}
    for (const output of cfg.outputs) {
      const input = output.source.type === 'response'
        ? selectPath(raw, output.source.path)
        : values[output.source.key]
      values[output.key] = runResponseOutputTransforms(
        output.transforms,
        output.dataViews,
        input,
        cfg.artifact?.children ?? [],
      )
    }
    const items = values.items
    if (!Array.isArray(items)) {
      throw new TypeError(`Vocab "${cfg.identity}" output "items" должен быть массивом.`)
    }
    return items
  }

  /** Читает explicit Mock JSON; отсутствие ссылки штатно означает пустой Vocab. */
  private _resolveMockValue(cfg: VocabRuntimeConfig): unknown {
    if (!cfg.mock) {
      return []
    }
    const document = Endge.mock.get(cfg.mock.identity)
    if (!cfg.mock.path) {
      return document
    }
    const value = selectDotPath(document, cfg.mock.path)
    if (value === MISSING_PATH) {
      throw new Error(`Vocab "${cfg.identity}": путь "${cfg.mock.path}" отсутствует в Mock "${cfg.mock.identity}".`)
    }
    return value
  }

  /**
   * Нормализует Vocab Id.
   */
  private _normalizeVocabId(vocabId: string | number): string {
    return String(vocabId ?? '').trim()
  }

  private _normalizeReferences(vocabs: readonly VocabReference[]): VocabReference[] {
    return [...new Map(vocabs
      .map(reference => [this._normalizeVocabId(reference), reference] as const)
      .filter(([key]) => Boolean(key))).values()]
  }

  private _requireVocabConfig(reference: VocabReference): VocabRuntimeConfig {
    const cfg = this._resolveVocabConfigByIdOrIdentity(reference)
    if (!cfg) {
      throw new Error(`Vocab "${String(reference)}" не найден.`)
    }
    return cfg
  }

  private async _loadShared(cfg: VocabRuntimeConfig, force: boolean, dataMode: 'live' | 'mock' = 'live'): Promise<any[]> {
    const requestKey = `${dataMode}:${cfg.identity}`
    const existing = this._inFlight.get(requestKey)
    if (existing) {
      return await existing
    }

    if (!force) {
      const cached = this._getCache(cfg)
      if (Array.isArray(cached)) {
        return cached
      }
    }

    const version = this._cacheVersions.get(cfg.identity) ?? 0
    const request = this.loadVocab(cfg.identity, { throwOnError: true, dataMode })
      .then((docs) => {
        if ((this._cacheVersions.get(cfg.identity) ?? 0) !== version) {
          delete this._byIdCache[cfg.identity]
          this._loadedIdentities.delete(cfg.identity)
          this._loadedAtByIdentity.delete(cfg.identity)
          this._loadedModeByIdentity.delete(cfg.identity)
          Raph.delete(`vocabsByIdentity.${cfg.identity}`)
          Raph.delete(`vocabs.${cfg.identity}`)
          if (cfg.slug) {
            Raph.delete(`vocabs.${cfg.slug}`)
          }
        }
        return docs
      })
      .finally(() => {
        if (this._inFlight.get(requestKey) === request) {
          this._inFlight.delete(requestKey)
        }
      })

    this._inFlight.set(requestKey, request)
    return await request
  }

  private _bumpCacheVersion(identity: string): void {
    this._cacheVersions.set(identity, (this._cacheVersions.get(identity) ?? 0) + 1)
  }

  private _normalizePolicy(policy: Partial<VocabLoadPolicy>): VocabLoadPolicy {
    return {
      strategy: policy.strategy ?? DEFAULT_VOCAB_LOAD_POLICY.strategy,
      maxAgeMs: policy.maxAgeMs === undefined
        ? DEFAULT_VOCAB_LOAD_POLICY.maxAgeMs
        : policy.maxAgeMs,
      onError: policy.onError ?? DEFAULT_VOCAB_LOAD_POLICY.onError,
    }
  }

  private _isFresh(identity: string, maxAgeMs: number | null): boolean {
    if (maxAgeMs === null) {
      return true
    }
    const loadedAt = this._loadedAtByIdentity.get(identity)
    return typeof loadedAt === 'number' && Date.now() - loadedAt <= maxAgeMs
  }

  private _markLoaded(identity: string, dataMode: 'live' | 'mock' = 'live'): void {
    this._loadedAtByIdentity.set(identity, Date.now())
    this._loadedModeByIdentity.set(identity, dataMode)
  }

  /**
   * Устанавливает By Identity Cache.
   */
  private _setByIdentityCache(identity: string, docs: any[]): void {
    this._byIdCache[identity] = Array.isArray(docs) ? docs : []
    Raph.set(`vocabsByIdentity.${identity}`, this._byIdCache[identity])
    this._loadedIdentities.add(identity)
  }

  /** Пишет canonical identity cache и переходный alias provider.collection. */
  private _setCache(cfg: VocabRuntimeConfig, docs: any[]): void {
    const values = Array.isArray(docs) ? docs : []
    this._setByIdentityCache(cfg.identity, values)
    Raph.set(`vocabs.${cfg.identity}`, values)
    if (cfg.slug && cfg.slug !== cfg.identity) {
      Raph.set(`vocabs.${cfg.slug}`, values)
    }
  }

  /** Читает canonical identity cache с переходным fallback на collection alias. */
  private _getCache(cfg: VocabRuntimeConfig): unknown {
    const canonical = Raph.get(`vocabs.${cfg.identity}`)
    return canonical !== undefined ? canonical : cfg.slug ? Raph.get(`vocabs.${cfg.slug}`) : undefined
  }

  /**
   * Разрешает Vocab Config By Id.
   */
  private _resolveVocabConfigById(vocabId: string | number): VocabRuntimeConfig | null {
    const artifact = Endge.program.getVocabArtifact(vocabId)
      ?? Endge.program.getVocabArtifact(Number(vocabId))
    return artifact ? this._createRuntimeConfig(artifact) : null
  }

  /**
   * Разрешает Vocab Config By Id Or Identity.
   */
  private _resolveVocabConfigByIdOrIdentity(idOrIdentity: string | number): VocabRuntimeConfig | null {
    const artifact = Endge.program.getVocabArtifact(idOrIdentity)
    return artifact ? this._createRuntimeConfig(artifact) : null
  }

  private _createRuntimeConfig(artifact: ProgramArtifact<VocabProgramPayload>): VocabRuntimeConfig | null {
    const idKey = this._normalizeVocabId(artifact.ref.id)
    const identity = String(artifact.ref.identity ?? '').trim()
    if (!idKey || !identity) {
      return null
    }

    if (artifact.status === 'error') {
      const message = artifact.diagnostics.find(item => item.severity === 'error')?.message ?? 'Vocab source содержит compile errors.'
      throw new Error(`Vocab "${identity}": ${message}`)
    }
    const provider = artifact.payload.provider ?? null
    const rawBaseUrl = provider?.baseUrl
    const baseApiUrl = typeof rawBaseUrl === 'string'
      ? rawBaseUrl
      : rawBaseUrl?.kind === 'env'
        ? `{${rawBaseUrl.name}}`
        : ''
    const slug = String(provider?.collection ?? '').trim()
    const auth = provider?.auth
    return {
      idKey,
      identity,
      baseApiUrl,
      slug,
      authMode: auth?.mode ?? 'inherit',
      authProfileIdentity: auth?.profile ?? null,
      provider,
      mock: artifact.payload.mock ?? null,
      outputs: artifact.payload.outputs,
      artifact,
    }
  }

  /** Находит runtime config справочника по identity или collection slug. */
  private _resolveVocabConfigByIdentityOrSlug(identity: string, collectionSlug: string): VocabRuntimeConfig | null {
    const normalizedIdentity = String(identity ?? '').trim()
    const normalizedSlug = String(collectionSlug ?? '').trim()

    const direct = normalizedIdentity ? Endge.program.getVocabArtifact(normalizedIdentity) : null
    const indexedIdentity = normalizedSlug ? this._index[normalizedSlug] : undefined
    const indexed = indexedIdentity ? Endge.program.getVocabArtifact(indexedIdentity) : null
    const fallback = direct ?? indexed

    if (!fallback) {
      return null
    }

    return this._createRuntimeConfig(fallback)
  }

  /** Собирает auth headers для обращения к внешнему справочнику. */
  private async _resolveAuthHeaders(cfg: { authMode?: 'inherit' | 'profile' | 'none', authProfileIdentity?: string | null }): Promise<Record<string, string>> {
    const mode = cfg.authMode ?? 'inherit'
    const session = await Endge.auth.requests.resolve(
      mode === 'profile'
        ? { mode: 'profile', profile: String(cfg.authProfileIdentity ?? '').trim() }
        : { mode },
    )
    return session.headers
  }

  /**
   * Разрешает Base Url.
   */
  private _resolveBaseUrl(rawUrl: string): string {
    const raw = String(rawUrl ?? '').trim()
    if (!raw) {
      return ''
    }

    const directlyResolved = Endge.workspace.variables.resolve<string>(raw, {
      fallback: raw,
      onInvalid: 'as-is',
    }) ?? raw

    return String(directlyResolved)
      .replace(/\{([^{}]+)\}/g, (_match: string, token: string) => {
        const name = String(token ?? '').trim()
        if (!name) {
          return ''
        }
        const value = Endge.workspace.variables.resolve<string>(`{${name}}`, {
          fallback: '',
          onInvalid: 'as-is',
        })
        return String(value ?? '')
      })
      .trim()
      .replace(/\/+$/, '')
  }

  /**
   * Внутренний helper модуля: extract Docs.
   */
  private _extractDocs(json: any): any[] {
    if (Array.isArray(json?.docs)) {
      return json.docs
    }
    if (Array.isArray(json)) {
      return json
    }
    return []
  }

  /**
   * Устанавливает Loading State.
   */
  private _setLoadingState(next: boolean): void {
    if (next) {
      this._loadingRequests += 1
    }
    else { this._loadingRequests = Math.max(0, this._loadingRequests - 1) }

    const value = this._loadingRequests > 0
    if (this.loading === value) {
      return
    }

    this.loading = value
    this.notify()
  }
}
