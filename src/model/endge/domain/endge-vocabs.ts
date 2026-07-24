import { Raph } from '@endge/raph'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type {
  VocabCacheOperationResult,
  VocabReference,
} from '@/domain/types/runtime/vocab-cache.types'
import { Endge } from '@/model/endge/kernel/endge'

type VocabRuntimeConfig = {
  idKey: string
  identity: string
  baseApiUrl: string
  slug: string
  authMode: 'inherit' | 'profile' | 'manual' | 'none'
  authProfileIdentity?: string | null
}

/**
 * Модуль загрузки и чтения external vocabs в Raph cache.
 */
export class EndgeVocabs extends EndgeModule {
  /**
   * slug -> namespace
   * Можно оставить для getNamespaceValues (чтобы понимать какие slugs в пространстве)
   */
  private index: Record<string, string> = {}
  private byIdCache: Record<string, any[]> = {}
  private readonly loadedIdentities = new Set<string>()
  private readonly inFlight = new Map<string, Promise<any[]>>()
  private readonly cacheVersions = new Map<string, number>()
  private _loadingRequests: number = 0
  loading: boolean = false

  /**
   * Строит индекс collectionSlug -> vocab identity из доменных документов vocabs.
   */
  init(): void {
    const nextIndex: Record<string, string> = {}

    for (const vocab of Endge.domain.getVocabs()) {
      if (vocab.active === false || vocab.mode !== 'external_payload')
        continue

      const identity = String(vocab.identity ?? '').trim()
      const slug = String(vocab.collectionSlug ?? '').trim()
      if (!identity || !slug)
        continue

      if (typeof nextIndex[slug] === 'undefined')
        nextIndex[slug] = identity
    }

    this.index = nextIndex
  }

  /**
   * Загружает словарь по identity или collectionSlug.
   * Namespace резолвится через доменный документ справочника.
   */
  async loadNamespace(namespace: string): Promise<void> {
    const ns: string = String(namespace ?? '').trim()
    if (!ns)
      return

    const cfg = this.resolveVocabConfigByIdentityOrSlug(ns, ns)
    if (!cfg) {
      console.log(`Vocab с identity или collectionSlug="${ns}" не найден`)
      return
    }

    const base = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!base)
      return

    const headers = await this.resolveAuthHeaders(cfg)

    try {
      const res = await fetch(`${base}/${cfg.slug}?limit=10000`, { headers })
      const json = await res.json()
      const docs = this.extractDocs(json)

      this.setByIdentityCache(cfg.identity, docs)
      Raph.set(`vocabs.${cfg.slug}`, docs)
    }
    catch (e: any) {
      const msg = e?.message ?? String(e)
      console.warn(`Ошибка при загрузке "${cfg.identity}/${cfg.slug}": ${msg}`)
    }
  }

  /**
   * Возвращает значения всех collections namespace или конкретного collection slug.
   */
  getNamespaceValues(namespace: string, vocabs: string | null = null): Array<any> {
    const ns: string = String(namespace ?? '').trim()
    if (!ns)
      return []

    if (vocabs != null) {
      return this.getVocabsValues(ns, vocabs)
    }

    const cfg = this.resolveVocabConfigByIdentityOrSlug(ns, ns)
    if (!cfg)
      return []

    return this.getVocabsValues(ns, cfg.slug)
  }

  /**
   * По сигнатуре namespace остаётся, но фактически не используется для чтения,
   * потому что в Raph ключ теперь без namespace.
   */
  getVocabsValues(namespace: string, vocabs: string): Array<any> {
    void namespace
    const vb: string = String(vocabs ?? '').trim()
    if (!vb)
      return []

    const data = Raph.get(`vocabs.${vb}`)
    return Array.isArray(data) ? data : []
  }

  /**
   * Получение значений словаря без namespace:
   * просто `vocabs.<slug>`
   *
   * Индекс больше не обязателен для чтения - оставлен только для других сценариев.
   */
  getValues(vocabs: string): Array<any> {
    const vb: string = String(vocabs ?? '').trim()
    if (!vb)
      return []

    const data = Raph.get(`vocabs.${vb}`)
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
  async getSample(vocabIdentity: string, collectionSlug: string, limit: number = 1): Promise<any[]> {
    const ns = String(vocabIdentity ?? '').trim()
    const slug = String(collectionSlug ?? '').trim()
    if (!ns || !slug)
      return []

    const cached = Raph.get(`vocabs.${slug}`)
    if (Array.isArray(cached) && cached.length > 0) {
      return cached.slice(0, limit)
    }

    const cfg = this.resolveVocabConfigByIdentityOrSlug(ns, slug)
    if (!cfg)
      return []

    const base = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!base)
      return []

    const headers = await this.resolveAuthHeaders(cfg)

    try {
      const url = `${base}/${cfg.slug}?limit=${Math.max(1, limit)}`
      const res = await fetch(url, { headers })
      const json = await res.json()
      const docs = this.extractDocs(json)
      return docs.slice(0, limit)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.getSample] ${cfg.identity}/${cfg.slug}:`, e?.message ?? e)
      return []
    }
  }

  /**
   * Возвращает значения словаря по id, используя Raph cache и локальный fallback cache.
   */
  getValuesById(vocabId: string | number): Array<any> {
    const cfg = this.resolveVocabConfigById(vocabId)
    if (!cfg)
      return []

    const byIdData = Raph.get(`vocabsByIdentity.${cfg.identity}`)
    if (Array.isArray(byIdData))
      return byIdData

    const fallback = this.byIdCache[cfg.identity]
    if (Array.isArray(fallback))
      return fallback

    const bySlug = Raph.get(`vocabs.${cfg.slug}`)
    if (!Array.isArray(bySlug))
      return []

    this.setByIdentityCache(cfg.identity, bySlug)
    return bySlug
  }

  /**
   * Проверяет, есть ли загруженные значения словаря по id.
   */
  hasCacheById(vocabId: string | number): boolean {
    return this.getValuesById(vocabId).length > 0
  }

  /**
   * Очищает cache словаря по id.
   */
  clearCacheById(vocabId: string | number): void {
    const cfg = this.resolveVocabConfigByIdOrIdentity(vocabId)
    if (!cfg)
      return

    this.bumpCacheVersion(cfg.identity)
    this.loadedIdentities.delete(cfg.identity)
    delete this.byIdCache[cfg.identity]
    Raph.delete(`vocabsByIdentity.${cfg.identity}`)
    Raph.delete(`vocabs.${cfg.slug}`)
  }

  /**
   * Загружает отсутствующие справочники параллельно и переиспользует cache.
   */
  async acquire(vocabs: readonly VocabReference[]): Promise<VocabCacheOperationResult[]> {
    return await Promise.all(this.normalizeReferences(vocabs).map(async (reference) => {
      const cfg = this.requireVocabConfig(reference)
      const cached = Raph.get(`vocabs.${cfg.slug}`)
      if (this.loadedIdentities.has(cfg.identity) || Array.isArray(cached)) {
        return {
          identity: cfg.identity,
          status: 'cache-hit',
          count: Array.isArray(cached) ? cached.length : 0,
        }
      }

      const docs = await this.loadShared(cfg, false)
      return {
        identity: cfg.identity,
        status: 'loaded',
        count: docs.length,
      }
    }))
  }

  /**
   * Принудительно обновляет справочники параллельно, сохраняя дедупликацию одновременных запросов.
   */
  async refresh(vocabs: readonly VocabReference[]): Promise<VocabCacheOperationResult[]> {
    return await Promise.all(this.normalizeReferences(vocabs).map(async (reference) => {
      const cfg = this.requireVocabConfig(reference)
      const docs = await this.loadShared(cfg, true)
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
  invalidate(vocabs: readonly VocabReference[]): VocabCacheOperationResult[] {
    return this.normalizeReferences(vocabs).map((reference) => {
      const cfg = this.requireVocabConfig(reference)
      const cached = Raph.get(`vocabs.${cfg.slug}`)
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
  async loadById(vocabId: string | number, limit: number = 10000): Promise<void> {
    const cfg = this.resolveVocabConfigById(vocabId)
    if (!cfg)
      return
    const headers = await this.resolveAuthHeaders(cfg)

    const maxLimit = Math.max(1, Number(limit) || 10000)
    const baseUrl = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl)
      return

    const url = `${baseUrl}/${cfg.slug}?limit=${maxLimit}`
    try {
      const res = await fetch(url, { headers })
      const json = await res.json()
      const docs = this.extractDocs(json)
      this.setByIdentityCache(cfg.identity, docs)
      Raph.set(`vocabs.${cfg.slug}`, docs)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.loadById] ${cfg.idKey}/${cfg.slug}:`, e?.message ?? e)
    }
  }

  /**
   * Возвращает sample словаря по id, используя cache или сетевую загрузку.
   */
  async getSampleById(vocabId: string | number, limit: number = 1): Promise<any[]> {
    const maxLimit = Math.max(1, Number(limit) || 1)
    const cfg = this.resolveVocabConfigById(vocabId)
    if (!cfg)
      return []

    const byIdCached = this.getValuesById(vocabId)
    if (byIdCached.length > 0)
      return byIdCached.slice(0, maxLimit)

    const bySlugCached = Raph.get(`vocabs.${cfg.slug}`)
    if (Array.isArray(bySlugCached) && bySlugCached.length > 0) {
      this.setByIdentityCache(cfg.identity, bySlugCached)
      return bySlugCached.slice(0, maxLimit)
    }

    const headers = await this.resolveAuthHeaders(cfg)

    const baseUrl = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl)
      return []

    try {
      const url = `${baseUrl}/${cfg.slug}?limit=${maxLimit}`
      const res = await fetch(url, { headers })
      const json = await res.json()
      const docs = this.extractDocs(json)
      this.setByIdentityCache(cfg.identity, docs)
      Raph.set(`vocabs.${cfg.slug}`, docs)
      return docs.slice(0, maxLimit)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.getSampleById] ${cfg.idKey}/${cfg.slug}:`, e?.message ?? e)
      return []
    }
  }

  /**
   * Полностью загружает словарь по id или identity с постраничным обходом.
   */
  async loadVocab(
    idOrIdentity: string | number,
    options: { throwOnError?: boolean } = {},
  ): Promise<any[]> {
    const cfg = this.resolveVocabConfigByIdOrIdentity(idOrIdentity)
    if (!cfg) {
      if (options.throwOnError)
        throw new Error(`Vocab "${String(idOrIdentity)}" не найден.`)
      return []
    }
    const headers = await this.resolveAuthHeaders(cfg)

    const baseUrl = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl) {
      if (options.throwOnError)
        throw new Error(`Vocab "${cfg.identity}" не содержит доступный baseApiUrl.`)
      return []
    }

    const pageSize = 1000
    const allDocs: any[] = []
    let page = 1

    this.setLoadingState(true)
    try {
      while (true) {
        const url = `${baseUrl}/${cfg.slug}?limit=${pageSize}&page=${page}`
        const res = await fetch(url, { headers })
        if (!res.ok)
          throw new Error(`HTTP ${res.status} ${res.statusText}`.trim())
        const json = await res.json()
        const docs = this.extractDocs(json)

        if (!docs.length)
          break

        allDocs.push(...docs)

        const hasNextPage = Boolean((json as any)?.hasNextPage)
        const nextPage = Number((json as any)?.nextPage ?? 0)
        const totalPages = Number((json as any)?.totalPages ?? 0)

        if (hasNextPage && nextPage > page) {
          page = nextPage
          continue
        }

        if (totalPages > page) {
          page += 1
          continue
        }

        if (docs.length < pageSize)
          break

        page += 1
      }

      this.setByIdentityCache(cfg.identity, allDocs)
      Raph.set(`vocabs.${cfg.slug}`, allDocs)

      console.log('[EndgeVocabs.loadVocab] loaded', {
        id: cfg.idKey,
        identity: cfg.identity,
        slug: cfg.slug,
        count: allDocs.length,
      })
      console.log(allDocs)

      return allDocs
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.loadVocab] ${cfg.idKey}/${cfg.slug}:`, e?.message ?? e)
      if (options.throwOnError)
        throw e
      return []
    }
    finally {
      this.setLoadingState(false)
    }
  }

  /**
   * Нормализует Vocab Id.
   */
  private normalizeVocabId(vocabId: string | number): string {
    return String(vocabId ?? '').trim()
  }

  private normalizeReferences(vocabs: readonly VocabReference[]): VocabReference[] {
    return [...new Map(vocabs
      .map(reference => [this.normalizeVocabId(reference), reference] as const)
      .filter(([key]) => Boolean(key))).values()]
  }

  private requireVocabConfig(reference: VocabReference): VocabRuntimeConfig {
    const cfg = this.resolveVocabConfigByIdOrIdentity(reference)
    if (!cfg)
      throw new Error(`Vocab "${String(reference)}" не найден.`)
    return cfg
  }

  private async loadShared(cfg: VocabRuntimeConfig, force: boolean): Promise<any[]> {
    const existing = this.inFlight.get(cfg.identity)
    if (existing)
      return await existing

    if (!force) {
      const cached = Raph.get(`vocabs.${cfg.slug}`)
      if (this.loadedIdentities.has(cfg.identity) || Array.isArray(cached))
        return Array.isArray(cached) ? cached : []
    }

    const version = this.cacheVersions.get(cfg.identity) ?? 0
    const request = this.loadVocab(cfg.identity, { throwOnError: true })
      .then((docs) => {
        if ((this.cacheVersions.get(cfg.identity) ?? 0) !== version) {
          delete this.byIdCache[cfg.identity]
          this.loadedIdentities.delete(cfg.identity)
          Raph.delete(`vocabsByIdentity.${cfg.identity}`)
          Raph.delete(`vocabs.${cfg.slug}`)
        }
        return docs
      })
      .finally(() => {
        if (this.inFlight.get(cfg.identity) === request)
          this.inFlight.delete(cfg.identity)
      })

    this.inFlight.set(cfg.identity, request)
    return await request
  }

  private bumpCacheVersion(identity: string): void {
    this.cacheVersions.set(identity, (this.cacheVersions.get(identity) ?? 0) + 1)
  }

  /**
   * Устанавливает By Identity Cache.
   */
  private setByIdentityCache(identity: string, docs: any[]): void {
    this.byIdCache[identity] = Array.isArray(docs) ? docs : []
    Raph.set(`vocabsByIdentity.${identity}`, this.byIdCache[identity])
    this.loadedIdentities.add(identity)
  }

  /**
   * Разрешает Vocab Config By Id.
   */
  private resolveVocabConfigById(vocabId: string | number): VocabRuntimeConfig | null {
    const vocab = Endge.domain.getVocabById(vocabId) ?? Endge.domain.getVocabById(Number(vocabId))
    if (!vocab)
      return null

    const idKey = this.normalizeVocabId(vocab.id)
    const identity = String(vocab.identity ?? '').trim()
    const baseApiUrl = String(vocab.baseApiUrl ?? '').trim()
    const slug = String(vocab.collectionSlug ?? '').trim()
    if (!idKey || !identity || !baseApiUrl || !slug)
      return null

    return { idKey, identity, baseApiUrl, slug, authMode: vocab.authMode ?? 'inherit', authProfileIdentity: vocab.authProfileIdentity ?? null }
  }

  /**
   * Разрешает Vocab Config By Id Or Identity.
   */
  private resolveVocabConfigByIdOrIdentity(idOrIdentity: string | number): VocabRuntimeConfig | null {
    const vocab = Endge.domain.getVocab(idOrIdentity)
    if (!vocab)
      return null

    const idKey = this.normalizeVocabId(vocab.id)
    const identity = String(vocab.identity ?? '').trim()
    const baseApiUrl = String(vocab.baseApiUrl ?? '').trim()
    const slug = String(vocab.collectionSlug ?? '').trim()
    if (!idKey || !identity || !baseApiUrl || !slug)
      return null

    return { idKey, identity, baseApiUrl, slug, authMode: vocab.authMode ?? 'inherit', authProfileIdentity: vocab.authProfileIdentity ?? null }
  }

  /** Находит runtime config справочника по identity или collection slug. */
  private resolveVocabConfigByIdentityOrSlug(identity: string, collectionSlug: string): VocabRuntimeConfig | null {
    const normalizedIdentity = String(identity ?? '').trim()
    const normalizedSlug = String(collectionSlug ?? '').trim()

    const direct = normalizedIdentity ? Endge.domain.getVocabByIdentity(normalizedIdentity) : null
    const indexedIdentity = normalizedSlug ? this.index[normalizedSlug] : undefined
    const indexed = indexedIdentity ? Endge.domain.getVocabByIdentity(indexedIdentity) : null
    const fallback = direct ?? indexed ?? Endge.domain.getVocabs().find((vocab) => {
      if (vocab.active === false || vocab.mode !== 'external_payload')
        return false
      return String(vocab.collectionSlug ?? '').trim() === normalizedSlug
    }) ?? null

    if (!fallback)
      return null

    return this.resolveVocabConfigByIdOrIdentity(fallback.identity || fallback.id)
  }

  /** Собирает auth headers для обращения к внешнему справочнику. */
  private async resolveAuthHeaders(cfg: { authMode?: 'inherit' | 'profile' | 'manual' | 'none'; authProfileIdentity?: string | null }): Promise<Record<string, string>> {
    const mode = cfg.authMode ?? 'inherit'
    if (mode === 'none')
      return {}
    const session = await Endge.auth.profiles.resolveRequestAuth({
      mode,
      authProfileIdentity: cfg.authProfileIdentity ?? undefined,
    })
    return session.headers ?? {}
  }

  /**
   * Разрешает Base Url.
   */
  private resolveBaseUrl(rawUrl: string): string {
    const raw = String(rawUrl ?? '').trim()
    if (!raw)
      return ''

    const directlyResolved = Endge.workspace.variables.resolve<string>(raw, {
      fallback: raw,
      onInvalid: 'as-is',
    }) ?? raw

    return String(directlyResolved)
      .replace(/\{([^{}]+)\}/g, (_match: string, token: string) => {
        const name = String(token ?? '').trim()
        if (!name)
          return ''
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
  private extractDocs(json: any): any[] {
    if (Array.isArray(json?.docs))
      return json.docs
    if (Array.isArray(json))
      return json
    return []
  }

  /**
   * Устанавливает Loading State.
   */
  private setLoadingState(next: boolean): void {
    if (next)
      this._loadingRequests += 1
    else
      this._loadingRequests = Math.max(0, this._loadingRequests - 1)

    const value = this._loadingRequests > 0
    if (this.loading === value)
      return

    this.loading = value
    this.notify()
  }
}
