import type {
  EndgeBindingMode,
  EndgeResolvedOverrideBase,
  EndgeResolveEngineConfig,
  EndgeResolveOptions,
  EndgeResolveSelectionMode,
  EndgeResolveSourceCommon,
} from '@/domain/types/configuration/resolve.types'

import { Endge } from '@/model/endge/kernel/endge'

interface OwnerNode {
  ownerType: string
  ownerId: number
}

interface NormalizedResolveOptions {
  ownerType: string
  ownerId: number
  targetType: string
  targetId: number | null
  targetKeys: Set<number>
  selector: string
  environmentId: number | null
}

/**
 * Общий каскадный движок резолва override-записей.
 * Поведение и presentation используют его как один и тот же алгоритм выбора
 * direct/inherited/environment-specific правил.
 */
export class EndgeResolveEngine<
  TSource extends EndgeResolveSourceCommon,
  TResolved extends EndgeResolvedOverrideBase,
> {
  /**
   * Принимает конфиг, который описывает:
   * откуда брать сырые записи, как выделять selector и как строить resolved-модель.
   */
  public constructor(private readonly _config: EndgeResolveEngineConfig<TSource, TResolved>) {}

  /**
   * Главная точка входа движка.
   * Нормализует входные параметры, собирает подходящие записи и затем применяет каскадные режимы.
   */
  public resolve(opts: EndgeResolveOptions, mode: EndgeResolveSelectionMode = 'all'): TResolved[] {
    const normalized = this._normalizeOptions(opts)
    if (!normalized) { return [] }
    if (!this._isProjectEnvironmentAllowed(normalized)) { return [] }

    const candidates = this._collectCandidates(normalized, mode)
    if (mode === 'direct-only') { return this._sortCandidates(candidates) }

    return this._applyModes(this._sortCandidates(candidates))
  }

  /**
   * Приводит входной запрос к единому виду:
   * нормализует типы, id, selector, target и актуальное окружение.
   */
  private _normalizeOptions(opts: EndgeResolveOptions): NormalizedResolveOptions | null {
    const ownerType = this._normalizeNodeType(opts.ownerType)
    const ownerId = this._resolveOwnerId(ownerType, opts.ownerId)
    if (!ownerType || ownerId == null) { return null }

    const targetType = this._normalizeNodeType(opts.targetType) || ownerType
    const targetId = this._resolveOwnerId(targetType, opts.targetId) ?? ownerId
    const targetKeys = new Set<number>()
    if (targetId != null) {
      const keys = this._resolveOwnerKeys(targetType, targetId)
      for (const key of keys) { targetKeys.add(key) }
      targetKeys.add(targetId)
    }

    return {
      ownerType,
      ownerId,
      targetType,
      targetId,
      targetKeys,
      selector: this._normalizeKey(opts.selector).toLowerCase(),
      environmentId: this._resolveEnvironmentId(opts.environmentId ?? this._getCurrentEnvironmentId()),
    }
  }

  /**
   * Собирает все сырые записи, которые подходят под owner/target/selector/environment.
   * На этом шаге правила ещё не склеиваются режимами replace/append/prepend/disable.
   */
  private _collectCandidates(
    opts: NormalizedResolveOptions,
    mode: EndgeResolveSelectionMode,
  ): TResolved[] {
    const chain = this._collectOwnerChain(opts.ownerType, opts.ownerId)
    if (chain.length === 0) { return [] }

    const currentKey = this._toOwnerNodeKey({ ownerType: opts.ownerType, ownerId: opts.ownerId })
    const selectedChain = mode === 'direct-only'
      ? chain.filter(node => this._toOwnerNodeKey(node) === currentKey)
      : mode === 'inherited-only'
        ? chain.filter(node => this._toOwnerNodeKey(node) !== currentKey)
        : chain

    if (selectedChain.length === 0) { return [] }

    const source = this._config.getSource()
    const chainDepth = new Map<string, number>()
    selectedChain.forEach((node, index) => {
      chainDepth.set(this._toOwnerNodeKey(node), index)
    })

    const out: TResolved[] = []
    for (const raw of source) {
      if (raw == null || raw.isEnabled === false) { continue }

      const rawOwnerType = this._normalizeNodeType(raw.ownerType)
      if (!rawOwnerType) { continue }
      const rawOwnerId = this._resolveOwnerId(rawOwnerType, raw.ownerId)
      if (rawOwnerId == null) { continue }

      const ownerNode = selectedChain.find((node) => {
        if (node.ownerType !== rawOwnerType) { return false }
        return node.ownerId === rawOwnerId
      })
      if (!ownerNode) { continue }

      const selector = this._normalizeKey(this._config.getSelector(raw)).toLowerCase()
      if (opts.selector && selector !== opts.selector) { continue }

      const rawTargetType = this._normalizeNodeType(raw.targetType)
      const effectiveRawTargetType = rawTargetType || opts.targetType
      const rawTargetId = this._resolveOwnerId(effectiveRawTargetType, raw.targetId)
      if (rawTargetType && rawTargetType !== opts.targetType) { continue }
      if (opts.targetId == null) {
        if (rawTargetId != null) { continue }
      }
      else if (rawTargetId != null && !opts.targetKeys.has(rawTargetId)) {
        continue
      }

      const bindingEnvironment = this._resolveEnvironmentId(raw.environmentId)
      if (bindingEnvironment != null) {
        if (opts.environmentId == null) { continue }
        if (bindingEnvironment !== opts.environmentId) { continue }
      }

      const modeText = this._normalizeKey(raw.mode).toLowerCase()
      const normalizedMode: EndgeBindingMode
        = modeText === 'append' || modeText === 'prepend' || modeText === 'disable'
          ? modeText
          : 'replace'
      const ownerNodeKey = this._toOwnerNodeKey(ownerNode)
      const depth = chainDepth.get(ownerNodeKey) ?? 0
      const sourceType = ownerNodeKey === currentKey ? 'direct' : 'inherited'
      const originBindingId = this._normalizeId(raw.originBindingId) ?? (sourceType === 'inherited' ? this._normalizeId(raw.id) : null)

      const resolved = this._config.buildResolved(raw, {
        requestedOwnerType: opts.ownerType,
        requestedOwnerId: opts.ownerId,
        requestedTargetType: opts.targetType,
        requestedTargetId: opts.targetId,
        selector,
        id: this._normalizeId(raw.id),
        identity: this._normalizeKey(raw.identity) || `binding-${raw.id ?? out.length + 1}`,
        displayName: this._normalizeKey(raw.displayName) || this._normalizeKey(raw.name) || selector,
        mode: normalizedMode,
        priority: Number.isFinite(Number(raw.priority)) ? Number(raw.priority) : 0,
        isEnabled: raw.isEnabled !== false,
        environmentId: bindingEnvironment,
        originBindingId,
        sourceOwnerType: ownerNode.ownerType,
        sourceOwnerId: ownerNode.ownerId,
        source: sourceType,
        depth,
      })

      if (!resolved) { continue }
      if (this._config.isResolvedValid && !this._config.isResolvedValid(resolved)) { continue }

      out.push(resolved)
    }

    return out
  }

  /**
   * Сортирует кандидаты так, чтобы каскад применялся предсказуемо:
   * сначала по глубине наследования, затем по окружению, приоритету и идентичности.
   */
  private _sortCandidates(list: TResolved[]): TResolved[] {
    return [...list].sort((a, b) => {
      if (a.depth !== b.depth) { return a.depth - b.depth }

      const aEnv = a.environmentId == null ? 0 : 1
      const bEnv = b.environmentId == null ? 0 : 1
      if (aEnv !== bEnv) { return aEnv - bEnv }

      if (a.priority !== b.priority) { return a.priority - b.priority }

      if (a.selector !== b.selector) { return this._normalizeKey(a.selector).localeCompare(this._normalizeKey(b.selector)) }

      return this._normalizeKey(a.identity).localeCompare(this._normalizeKey(b.identity))
    })
  }

  /**
   * Применяет режимы override-каскада внутри каждого selector:
   * disable очищает набор, replace заменяет, prepend ставит в начало, append добавляет в конец.
   */
  private _applyModes(sorted: TResolved[]): TResolved[] {
    const grouped = new Map<string, TResolved[]>()

    for (const item of sorted) {
      const key = this._normalizeKey(item.selector) || '__default__'
      const bucket = grouped.get(key) ?? []

      if (item.mode === 'disable') {
        bucket.length = 0
        grouped.set(key, bucket)
        continue
      }
      if (item.mode === 'replace') {
        bucket.length = 0
        bucket.push(item)
        grouped.set(key, bucket)
        continue
      }
      if (item.mode === 'prepend') {
        bucket.unshift(item)
        grouped.set(key, bucket)
        continue
      }
      bucket.push(item)
      grouped.set(key, bucket)
    }

    const out: TResolved[] = []
    for (const items of grouped.values()) { out.push(...items) }
    return this._sortCandidates(out)
  }

  /**
   * Строит цепочку owner-ов от родителей к текущему узлу.
   * Эта цепочка используется, чтобы отличать direct и inherited правила.
   */
  private _collectOwnerChain(ownerType: string, ownerId: number): OwnerNode[] {
    const visited = new Set<string>()
    const chain: OwnerNode[] = []

    const walk = (node: OwnerNode): void => {
      const key = this._toOwnerNodeKey(node)
      if (!node.ownerType || node.ownerId == null || visited.has(key)) { return }
      visited.add(key)

      const parents = this._getInheritedRefs(node.ownerType, node.ownerId)
      for (const parent of parents) { walk(parent) }

      chain.push(node)
    }

    walk({ ownerType, ownerId })
    return chain
  }

  /**
   * Возвращает прямые ссылки наследования для owner из `meta.inheritedFrom`.
   */
  private _getInheritedRefs(ownerType: string, ownerId: number): OwnerNode[] {
    const entity = this._resolveOwnerEntity(ownerType, ownerId)
    const inheritedFrom = Array.isArray(entity?.meta?.inheritedFrom) ? entity.meta.inheritedFrom : []
    const refs: OwnerNode[] = []

    for (const ref of inheritedFrom) {
      const parentType = this._normalizeNodeType(ref?.docType)
      if (!parentType) { continue }
      const parentId = this._resolveOwnerId(parentType, ref?.docId ?? ref?.docIdentity)
      if (parentId == null) { continue }
      refs.push({ ownerType: parentType, ownerId: parentId })
    }

    return refs
  }

  /**
   * Находит доменную сущность owner по типу и id/identity.
   * Нужен для разрешения наследования, target-ключей и дополнительных ограничений.
   */
  private _resolveOwnerEntity(ownerType: string, ownerId: unknown): any | null {
    if (ownerType === 'tenant') { return Endge.domain.getTenant(ownerId as any) }
    if (ownerType === 'project') { return Endge.domain.getProject(ownerId as any) }
    if (ownerType === 'page-template') { return Endge.domain.getPageTemplate(ownerId as any) }
    if (ownerType === 'page') { return Endge.domain.getPage(ownerId as any) }
    if (ownerType === 'component') { return Endge.domain.getComponent(ownerId as any) }
    if (ownerType === 'query') { return Endge.domain.getQuery(ownerId as any) }
    if (ownerType === 'filter') { return Endge.domain.getFilter(ownerId as any) }
    return null
  }

  /**
   * Собирает набор допустимых id для target-сопоставления.
   * Это позволяет сравнивать как прямой id, так и id, полученный через резолв сущности.
   */
  private _resolveOwnerKeys(ownerType: string, ownerId: number): Set<number> {
    const keys = new Set<number>()
    keys.add(ownerId)

    const entity = this._resolveOwnerEntity(ownerType, ownerId)
    const id = this._normalizeId(entity?.id)
    if (id != null) { keys.add(id) }

    return keys
  }

  /**
   * Проверяет, можно ли вообще выполнять резолв проекта в выбранном окружении.
   * Если у проекта задан whitelist окружений, чужие environment сразу отсекаются.
   */
  private _isProjectEnvironmentAllowed(opts: {
    ownerType: string
    ownerId: number
    environmentId: number | null
  }): boolean {
    if (opts.ownerType !== 'project') { return true }
    if (opts.environmentId == null) { return true }

    const project = Endge.domain.getProject(opts.ownerId)
    const allowed = Array.isArray(project?.allowedEnvironmentIds) ? project.allowedEnvironmentIds : []
    if (allowed.length === 0) { return true }

    return allowed.some((id: unknown) => {
      const allowedId = this._resolveEnvironmentId(id)
      return allowedId != null && allowedId === opts.environmentId
    })
  }

  /**
   * Приводит разные варианты docType к каноническому набору owner-типов движка.
   */
  private _normalizeNodeType(value: unknown): string {
    const raw = this._normalizeKey(value).toLowerCase()
    if (!raw) { return '' }

    if (raw === 'tenant' || raw === 'project' || raw === 'page-template' || raw === 'page' || raw === 'filter' || raw === 'table-cell') { return raw }
    if (raw === 'component' || raw === 'component-table' || raw === 'component-dsl') { return 'component' }
    if (raw === 'query' || raw === 'query-rest' || raw === 'query-gql' || raw === 'query-custom') { return 'query' }

    return ''
  }

  /**
   * Безопасно приводит произвольное значение к обрезанной строке.
   */
  private _normalizeKey(value: unknown): string {
    return String(value ?? '').trim()
  }

  /**
   * Пытается распарсить значение как числовой id.
   * Возвращает `null`, если id отсутствует или невалиден.
   */
  private _normalizeId(value: unknown): number | null {
    if (value == null) { return null }
    if (typeof value === 'number') { return Number.isFinite(value) ? value : null }
    const text = this._normalizeKey(value)
    if (!text) { return null }
    const parsed = Number(text)
    return Number.isFinite(parsed) ? parsed : null
  }

  /**
   * Разрешает owner-id из числа, строки или identity сущности.
   */
  private _resolveOwnerId(ownerType: string, value: unknown): number | null {
    const direct = this._normalizeId(value)
    if (direct != null) { return direct }

    const text = this._normalizeKey(value)
    if (!text) { return null }

    const entity = this._resolveOwnerEntity(ownerType, text)
    const entityId = this._normalizeId(entity?.id)
    if (entityId != null) { return entityId }

    return this._normalizeId(text)
  }

  /**
   * Разрешает environment-id из числа, строки или identity окружения.
   */
  private _resolveEnvironmentId(value: unknown): number | null {
    const direct = this._normalizeId(value)
    if (direct != null) { return direct }

    const text = this._normalizeKey(value)
    if (!text) { return null }

    const environment = Endge.domain.getEnvironment(text)
    const environmentId = this._normalizeId(environment?.id)
    if (environmentId != null) { return environmentId }

    return this._normalizeId(text)
  }

  /**
   * Берёт текущее окружение приложения и превращает его в числовой id,
   * если окружение явно не было передано в запрос резолва.
   */
  private _getCurrentEnvironmentId(): number | null {
    const current = Endge.context.getCurrentEnvironment?.()
    const currentId = this._normalizeId((current as any)?.id)
    if (currentId != null) { return currentId }
    return this._resolveEnvironmentId((current as any)?.identity ?? current)
  }

  /**
   * Формирует стабильный строковый ключ узла owner-цепочки.
   */
  private _toOwnerNodeKey(node: OwnerNode): string {
    return `${node.ownerType}:${node.ownerId}`
  }
}
