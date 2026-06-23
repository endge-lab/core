import type { RSettings } from '@/domain/entities/reflect/RSettings'

import { Raph } from '@endge/raph'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/endge'

export class EndgeVocabs extends EndgeModule {
  /**
   * slug -> namespace
   * Можно оставить для getNamespaceValues (чтобы понимать какие slugs в пространстве)
   */
  private index: Record<string, string> = {}
  private byIdCache: Record<string, any[]> = {}
  private _loadingRequests: number = 0
  loading: boolean = false

  init(): void {
    const settings = Endge.domain.getSetting('general') as RSettings | undefined
    if (!settings) {
      console.log('settings.general не найден - vocabs init пропускаем')
      this.index = {}
      return
    }

    const spaces = Array.isArray(settings.vocabs) ? settings.vocabs : []
    const nextIndex: Record<string, string> = {}

    for (const space of spaces) {
      const ns: string = String(space?.identity ?? '').trim()
      if (!ns)
        continue

      const collections: { name: string }[] = Array.isArray(space.collections)
        ? space.collections
        : []

      for (const col of collections) {
        const slug: string = String(col?.name ?? '').trim()
        if (!slug)
          continue

        if (typeof nextIndex[slug] === 'undefined')
          nextIndex[slug] = ns
      }
    }

    this.index = nextIndex
  }

  async loadNamespace(namespace: string): Promise<void> {
    const ns: string = String(namespace ?? '').trim()
    if (!ns)
      return

    const settings = Endge.domain.getSetting('general') as RSettings | undefined
    if (!settings) {
      console.log('settings.general не найден - vocabs пропускаем')
      return
    }

    const vocabs = Array.isArray(settings.vocabs) ? settings.vocabs : []
    if (!vocabs.length) {
      console.log('В settings.general.vocabs нет записей - vocabs пропускаем')
      return
    }

    const space = vocabs.find(v => v.identity === ns)
    if (!space) {
      console.log(`Vocab с identity="${ns}" не найден`)
      return
    }

    const baseApiUrl: string | undefined = space.baseApiUrl
    const collections: { name: string }[] = Array.isArray(space.collections)
      ? space.collections
      : []

    if (!baseApiUrl) {
      console.log(`У vocabs["${ns}"] не задан baseApiUrl`)
      return
    }

    if (!collections.length) {
      console.log(`У vocabs["${ns}"] нет collections - нечего загружать`)
      return
    }

    const base = baseApiUrl.replace(/\/+$/, '')

    const isAuth: boolean = Endge.auth.isAuthenticated
    if (!isAuth)
      return

    for (const col of collections) {
      const slug = col?.name
      if (!slug)
        continue

      const url = `${base}/${slug}`

      try {
        const res = await fetch(`${url}?limit=10000`)
        const json = await res.json()

        let docs: any[] = []
        if (Array.isArray(json?.docs))
          docs = json.docs
        else if (Array.isArray(json))
          docs = json

        // храним БЕЗ namespace
        Raph.set(`vocabs.${slug}`, docs)
      }
      catch (e: any) {
        const msg = e?.message ?? String(e)
        console.warn(`Ошибка при загрузке "${ns}/${slug}": ${msg}`)
      }
    }
  }

  getNamespaceValues(namespace: string, vocabs: string | null = null): Array<any> {
    const ns: string = String(namespace ?? '').trim()
    if (!ns)
      return []

    if (vocabs != null) {
      return this.getVocabsValues(ns, vocabs)
    }

    const settings = Endge.domain.getSetting('general') as RSettings | undefined
    if (!settings)
      return []

    const space = settings.vocabs.find(v => v.identity === ns)
    if (!Array.isArray(space?.collections))
      return []

    const result: any[] = []

    for (const col of space.collections) {
      const slug = col?.name
      if (!slug)
        continue

      const values = this.getVocabsValues(ns, slug)
      if (values.length)
        result.push(...values)
    }

    return result
  }

  /**
   * По сигнатуре namespace остаётся, но фактически не используется для чтения,
   * потому что в Raph ключ теперь без namespace.
   */
  getVocabsValues(namespace: string, vocabs: string): Array<any> {
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
   * @param vocabIdentity identity набора в settings.general.vocabs
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

    const settings = Endge.domain.getSetting('general') as RSettings | undefined
    if (!settings)
      return []

    const vocabs = Array.isArray(settings.vocabs) ? settings.vocabs : []
    const space = vocabs.find((v: any) => v.identity === ns)
    if (!space?.baseApiUrl)
      return []

    const base = String(space.baseApiUrl).replace(/\/+$/, '')
    if (!Endge.auth.isAuthenticated)
      return []

    try {
      const url = `${base}/${slug}?limit=${Math.max(1, limit)}`
      const res = await fetch(url)
      const json = await res.json()
      let docs: any[] = []
      if (Array.isArray(json?.docs))
        docs = json.docs
      else if (Array.isArray(json))
        docs = json
      return docs.slice(0, limit)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.getSample] ${ns}/${slug}:`, e?.message ?? e)
      return []
    }
  }

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

  hasCacheById(vocabId: string | number): boolean {
    return this.getValuesById(vocabId).length > 0
  }

  clearCacheById(vocabId: string | number): void {
    const cfg = this.resolveVocabConfigById(vocabId)
    if (!cfg)
      return

    delete this.byIdCache[cfg.identity]
    Raph.set(`vocabsByIdentity.${cfg.identity}`, [])
  }

  async loadById(vocabId: string | number, limit: number = 10000): Promise<void> {
    const cfg = this.resolveVocabConfigById(vocabId)
    if (!cfg)
      return
    if (!Endge.auth.isAuthenticated)
      return

    const maxLimit = Math.max(1, Number(limit) || 10000)
    const baseUrl = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl)
      return

    const url = `${baseUrl}/${cfg.slug}?limit=${maxLimit}`
    try {
      const res = await fetch(url)
      const json = await res.json()
      const docs = this.extractDocs(json)
      this.setByIdentityCache(cfg.identity, docs)
      Raph.set(`vocabs.${cfg.slug}`, docs)
    }
    catch (e: any) {
      console.warn(`[EndgeVocabs.loadById] ${cfg.idKey}/${cfg.slug}:`, e?.message ?? e)
    }
  }

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

    if (!Endge.auth.isAuthenticated)
      return []

    const baseUrl = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl)
      return []

    try {
      const url = `${baseUrl}/${cfg.slug}?limit=${maxLimit}`
      const res = await fetch(url)
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

  async loadVocab(idOrIdentity: string | number): Promise<any[]> {
    const cfg = this.resolveVocabConfigByIdOrIdentity(idOrIdentity)
    if (!cfg)
      return []
    if (!Endge.auth.isAuthenticated)
      return []

    const baseUrl = this.resolveBaseUrl(cfg.baseApiUrl)
    if (!baseUrl)
      return []

    const pageSize = 1000
    const allDocs: any[] = []
    let page = 1

    this.setLoadingState(true)
    try {
      while (true) {
        const url = `${baseUrl}/${cfg.slug}?limit=${pageSize}&page=${page}`
        const res = await fetch(url)
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
      return []
    }
    finally {
      this.setLoadingState(false)
    }
  }

  private normalizeVocabId(vocabId: string | number): string {
    return String(vocabId ?? '').trim()
  }

  private setByIdentityCache(identity: string, docs: any[]): void {
    this.byIdCache[identity] = Array.isArray(docs) ? docs : []
    Raph.set(`vocabsByIdentity.${identity}`, this.byIdCache[identity])
  }

  private resolveVocabConfigById(vocabId: string | number): { idKey: string; identity: string; baseApiUrl: string; slug: string } | null {
    const vocab = Endge.domain.getVocabById(vocabId) ?? Endge.domain.getVocabById(Number(vocabId))
    if (!vocab)
      return null

    const idKey = this.normalizeVocabId(vocab.id)
    const identity = String(vocab.identity ?? '').trim()
    const baseApiUrl = String(vocab.baseApiUrl ?? '').trim()
    const slug = String(vocab.collectionSlug ?? '').trim()
    if (!idKey || !identity || !baseApiUrl || !slug)
      return null

    return { idKey, identity, baseApiUrl, slug }
  }

  private resolveVocabConfigByIdOrIdentity(idOrIdentity: string | number): { idKey: string; identity: string; baseApiUrl: string; slug: string } | null {
    const vocab = Endge.domain.getVocab(idOrIdentity)
    if (!vocab)
      return null

    const idKey = this.normalizeVocabId(vocab.id)
    const identity = String(vocab.identity ?? '').trim()
    const baseApiUrl = String(vocab.baseApiUrl ?? '').trim()
    const slug = String(vocab.collectionSlug ?? '').trim()
    if (!idKey || !identity || !baseApiUrl || !slug)
      return null

    return { idKey, identity, baseApiUrl, slug }
  }

  private resolveBaseUrl(rawUrl: string): string {
    const raw = String(rawUrl ?? '').trim()
    if (!raw)
      return ''

    const directlyResolved = Endge.vars.resolve<string>(raw, {
      fallback: raw,
      onInvalid: 'as-is',
    }) ?? raw

    return String(directlyResolved)
      .replace(/\{([^{}]+)\}/g, (_match: string, token: string) => {
        const name = String(token ?? '').trim()
        if (!name)
          return ''
        const value = Endge.vars.resolve<string>(`{${name}}`, {
          fallback: '',
          onInvalid: 'as-is',
        })
        return String(value ?? '')
      })
      .trim()
      .replace(/\/+$/, '')
  }

  private extractDocs(json: any): any[] {
    if (Array.isArray(json?.docs))
      return json.docs
    if (Array.isArray(json))
      return json
    return []
  }

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
