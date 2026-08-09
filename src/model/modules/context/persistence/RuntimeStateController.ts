import type {
  EndgePersistenceScope,
  EndgeStorageAdapter,
  RuntimeStateControllerLike,
  RuntimeStateDocument,
} from '@/domain/types/runtime/context-persistence.types'

export function buildRuntimeStateStorageKey(
  scope: EndgePersistenceScope,
  runtimeId: string,
): string {
  return [
    'endge',
    'runtime-state',
    'v1',
    `workspace:${encodeScopePart(scope.workspaceId)}`,
    `tenant:${encodeScopePart(scope.tenantId)}`,
    `project:${encodeScopePart(scope.projectId)}`,
    `environment:${encodeScopePart(scope.environmentId)}`,
    `user:${encodeScopePart(scope.userId)}`,
    `runtime:${encodeScopePart(runtimeId)}`,
  ].join(':')
}

export class RuntimeStateController implements RuntimeStateControllerLike {
  public readonly runtimeId: string
  public readonly storageId: string
  public readonly storageKey: string
  public readonly scope: EndgePersistenceScope

  private readonly _adapter: EndgeStorageAdapter

  public constructor(input: {
    runtimeId: string
    storageId?: string
    scope: EndgePersistenceScope
    adapter: EndgeStorageAdapter
  }) {
    this.runtimeId = normalizeRequiredId(input.runtimeId, 'runtimeId')
    this.storageId = normalizeRequiredId(input.storageId ?? input.runtimeId, 'storageId')
    this.scope = { ...input.scope }
    this._adapter = input.adapter
    this.storageKey = buildRuntimeStateStorageKey(this.scope, this.storageId)
  }

  public get<T>(entityKey: string, section: string, fallback: T): T {
    const normalizedEntityKey = normalizeRequiredId(entityKey, 'entityKey')
    const normalizedSection = normalizeRequiredId(section, 'section')
    const value = this.readDocument().state[normalizedEntityKey]?.[normalizedSection]

    return value === undefined ? fallback : value as T
  }

  public set<T>(entityKey: string, section: string, value: T): void {
    const normalizedEntityKey = normalizeRequiredId(entityKey, 'entityKey')
    const normalizedSection = normalizeRequiredId(section, 'section')
    const document = this.readDocument()

    document.state[normalizedEntityKey] ??= {}
    document.state[normalizedEntityKey][normalizedSection] = value

    this._adapter.write(this.storageKey, document)
  }

  public remove(entityKey: string, section?: string): void {
    const normalizedEntityKey = normalizeRequiredId(entityKey, 'entityKey')
    const document = this.readDocument()

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

  private readDocument(): RuntimeStateDocument {
    try {
      return this._adapter.read<RuntimeStateDocument>(this.storageKey) ?? this.createDefaultDocument()
    }
    catch {
      return this.createDefaultDocument()
    }
  }

  private createDefaultDocument(): RuntimeStateDocument {
    return {
      version: 1,
      scope: { ...this.scope },
      runtimeId: this.runtimeId,
      state: {},
    }
  }
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
