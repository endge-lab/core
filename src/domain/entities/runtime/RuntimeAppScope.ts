import type { RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type { RuntimeExecutableModel } from '@/domain/types/runtime.types'
import type { AnyRuntimeHost } from '@/model/services/runtime/RuntimeStrategy'

export type RuntimeAppScopeCollisionPolicy = 'multi' | 'reject' | 'replace'

export interface RuntimeAppScopeOptions {
  /** Уникальный id scope внутри EndgeRuntime. */
  id: string
  /** Публичный корень runtime data в Raph. */
  rootPath: string
  /** Политика повторного запуска root entity в этом scope. */
  collisionPolicy?: RuntimeAppScopeCollisionPolicy
  /** Persistence policy по умолчанию для host-ов scope. */
  persistence?: 'disabled' | 'local'
}

export interface RuntimeAppScopeAddress {
  runtimeId: string
  localId: string
  runtimePath: string
}

interface RuntimeAppScopeOwner {
  execute: (model: RuntimeExecutableModel, meta?: Record<string, any>) => AnyRuntimeHost | null
  getRuntimeHostsByEntity: (
    entityType: RuntimeEntityType,
    entityIdentity: string,
    appScopeId?: string,
  ) => AnyRuntimeHost[]
  destroyRuntimeTree: (runtimeId: string) => void
}

/**
 * Изолированный корень runtime-приложения.
 *
 * Scope владеет публичным Raph namespace, политикой повторного запуска и
 * автоматическим выделением локальных instance id. Caller не формирует
 * глобальные runtime-id вручную.
 */
export class RuntimeAppScope {
  public readonly id: string
  public readonly rootPath: string
  public readonly collisionPolicy: RuntimeAppScopeCollisionPolicy
  public readonly persistence: 'disabled' | 'local'

  private readonly _owner: RuntimeAppScopeOwner
  private readonly _nextIndex = new Map<string, number>()

  public constructor(owner: RuntimeAppScopeOwner, options: RuntimeAppScopeOptions) {
    this._owner = owner
    this.id = normalizeRequired(options.id, 'id')
    this.rootPath = normalizePath(options.rootPath)
    this.collisionPolicy = options.collisionPolicy ?? 'multi'
    this.persistence = options.persistence ?? 'disabled'
  }

  /** Запускает root entity в этом AppScope. */
  public execute(
    model: RuntimeExecutableModel,
    meta: Record<string, any> = {},
  ): AnyRuntimeHost | null {
    return this._owner.execute(model, {
      ...meta,
      appScope: this,
      scopeRoot: true,
    })
  }

  /** Возвращает активный root runtime entity по domain identity. */
  public resolve<T = AnyRuntimeHost>(
    entityType: RuntimeEntityType,
    identity: string,
  ): T | null {
    const hosts = this._owner.getRuntimeHostsByEntity(entityType, identity, this.id)
    return (hosts.find(host => host.meta.scopeRoot === true) ?? hosts[0] ?? null) as T | null
  }

  /** Удаляет runtime tree entity из этого scope. */
  public destroy(entityType: RuntimeEntityType, identity: string): void {
    const runtime = this.resolve(entityType, identity)
    if (runtime && typeof runtime === 'object' && 'id' in runtime) {
      this._owner.destroyRuntimeTree(String(runtime.id))
    }
  }

  /** Строит внутренний runtime id и независимый от него публичный Raph path. */
  public allocate(input: {
    entityType: RuntimeEntityType
    identity: string
    explicitRuntimeId?: string | null
    requestedLocalId?: string | null
    scopeRoot: boolean
  }): RuntimeAppScopeAddress {
    const identity = normalizeRequired(input.identity, 'identity')
    const explicitRuntimeId = String(input.explicitRuntimeId ?? '').trim()
    const requestedLocalId = String(input.requestedLocalId ?? '').trim()

    let localId: string
    let runtimeId: string
    if (explicitRuntimeId) {
      runtimeId = explicitRuntimeId
      localId = requestedLocalId || explicitRuntimeId
    }
    else if (input.scopeRoot && this.collisionPolicy !== 'multi') {
      localId = identity
      runtimeId = `${this.id}:${input.entityType}:${identity}`
    }
    else {
      const counterKey = `${input.entityType}:${identity}`
      const index = this._nextIndex.get(counterKey) ?? 0
      this._nextIndex.set(counterKey, index + 1)
      localId = requestedLocalId || `${identity}-${index}`
      runtimeId = `${this.id}:${input.entityType}:${localId}`
    }

    return {
      runtimeId,
      localId,
      runtimePath: [
        this.rootPath,
        runtimeEntityCollection(input.entityType),
        encodePathPart(localId),
      ].join('.'),
    }
  }

  /** Сбрасывает automatic instance counters при reset общего runtime. */
  public reset(): void {
    this._nextIndex.clear()
  }
}

function runtimeEntityCollection(entityType: RuntimeEntityType): string {
  const collections: Record<RuntimeEntityType, string> = {
    action: 'actions',
    component: 'components',
    'component-sfc': 'component-sfcs',
    composition: 'compositions',
    filter: 'filters',
    page: 'pages',
    project: 'projects',
    query: 'queries',
    store: 'stores',
    table: 'tables',
    view: 'views',
  }
  return collections[entityType]
}

function normalizeRequired(value: unknown, field: string): string {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    throw new Error(`[RuntimeAppScope] ${field} is required.`)
  }
  return normalized
}

function normalizePath(value: unknown): string {
  return normalizeRequired(value, 'rootPath').replace(/^\.+|\.+$/g, '')
}

function encodePathPart(value: string): string {
  return encodeURIComponent(String(value)).replace(/\./g, '%2E')
}
