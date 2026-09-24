import type {
  EndgePersistenceScope,
  EndgePersistenceScopeResolver,
  EndgeStorageAdapter,
  RuntimeStateControllerLike,
  RuntimeStateDocument,
} from '@/features/core/modules/context/domain/context-persistence.types'

export function buildRuntimeStateStorageKey(
  scope: EndgePersistenceScope,
  runtimeId: string,
): string {
  return [
    'endge',
    'runtime-state',
    'v2',
    `workspace:${encodeScopePart(scope.workspaceId)}`,
    `facets:${encodeScopePart(serializeFacetSelections(scope.facetSelections))}`,
    `user:${encodeScopePart(scope.userId)}`,
    `runtime:${encodeScopePart(runtimeId)}`,
  ].join(':')
}

export class RuntimeStateController implements RuntimeStateControllerLike {
  public readonly runtimeId: string
  public readonly storageId: string

  private readonly _adapter: EndgeStorageAdapter
  private readonly _resolveScope: EndgePersistenceScopeResolver

  public constructor(input: {
    runtimeId: string
    storageId?: string
    scope: EndgePersistenceScope | EndgePersistenceScopeResolver
    adapter: EndgeStorageAdapter
  }) {
    this.runtimeId = normalizeRequiredId(input.runtimeId, 'runtimeId')
    this.storageId = normalizeRequiredId(input.storageId ?? input.runtimeId, 'storageId')
    const scope = input.scope
    this._resolveScope = typeof scope === 'function'
      ? scope
      : () => scope
    this._adapter = input.adapter
  }

  /**
   * Возвращает актуальный persistence scope, включая текущую session identity.
   */
  public get scope(): EndgePersistenceScope {
    return { ...this._resolveScope() }
  }

  /**
   * Строит storage key из актуального scope, чтобы переавторизация не сохраняла данные прежнему пользователю.
   */
  public get storageKey(): string {
    return buildRuntimeStateStorageKey(this.scope, this.storageId)
  }

  public get<T>(entityKey: string, section: string, fallback: T): T {
    const normalizedEntityKey = normalizeRequiredId(entityKey, 'entityKey')
    const normalizedSection = normalizeRequiredId(section, 'section')
    const value = this._readDocument().state[normalizedEntityKey]?.[normalizedSection]

    return value === undefined ? fallback : value as T
  }

  public set<T>(entityKey: string, section: string, value: T): void {
    const normalizedEntityKey = normalizeRequiredId(entityKey, 'entityKey')
    const normalizedSection = normalizeRequiredId(section, 'section')
    const document = this._readDocument()

    document.state[normalizedEntityKey] ??= Object.create(null)
    document.state[normalizedEntityKey][normalizedSection] = value

    this._adapter.write(this.storageKey, document)
  }

  public remove(entityKey: string, section?: string): void {
    const normalizedEntityKey = normalizeRequiredId(entityKey, 'entityKey')
    const document = this._readDocument()

    if (section == null) {
      delete document.state[normalizedEntityKey]
      this._adapter.write(this.storageKey, document)
      return
    }

    const normalizedSection = normalizeRequiredId(section, 'section')
    delete document.state[normalizedEntityKey]?.[normalizedSection]
    if (
      document.state[normalizedEntityKey]
      && Object.keys(document.state[normalizedEntityKey]).length === 0
    ) {
      delete document.state[normalizedEntityKey]
    }

    this._adapter.write(this.storageKey, document)
  }

  public clear(): void {
    this._adapter.remove(this.storageKey)
  }

  private _readDocument(): RuntimeStateDocument {
    const document = this._createDefaultDocument()
    try {
      const stored = this._adapter.read<unknown>(this.storageKey)
      if (!isRecord(stored) || stored.version !== 2 || !isRecord(stored.state)
        || typeof stored.runtimeId !== 'string' || !isRecord(stored.scope)) {
        return document
      }
      const storedScope = stored.scope
      if (!samePersistenceScope(storedScope, document.scope)) {
        return document
      }
      // Оба уровня ключей принадлежат consumer: __proto__ и constructor тоже обычные данные.
      for (const [key, sections] of Object.entries(stored.state)) {
        if (isRecord(sections)) {
          document.state[key] = Object.assign(Object.create(null), sections)
        }
      }
      return document
    }
    catch {
      return document
    }
  }

  private _createDefaultDocument(): RuntimeStateDocument {
    return {
      version: 2,
      scope: { ...this.scope },
      runtimeId: this.runtimeId,
      state: Object.create(null),
    }
  }
}

function serializeFacetSelections(
  selections: EndgePersistenceScope['facetSelections'],
): string {
  return JSON.stringify(selections.map(selection => [selection.facetIdentity, selection.documentIdentity]))
}

function samePersistenceScope(
  stored: Record<string, unknown>,
  expected: EndgePersistenceScope,
): boolean {
  return stored.workspaceId === expected.workspaceId
    && stored.userId === expected.userId
    && Array.isArray(stored.facetSelections)
    && JSON.stringify(stored.facetSelections) === JSON.stringify(expected.facetSelections)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function encodeScopePart(value: string): string {
  return encodeURIComponent(String(value ?? '').trim())
}

function normalizeRequiredId(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error(`[RuntimeStateController] ${field} is required.`)
  }

  return normalized
}
