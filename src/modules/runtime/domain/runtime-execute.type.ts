import type { EndgePersistenceDriver } from '@/modules/context/domain/context-persistence.types'
import type { RuntimeArtifactReader } from '@/modules/runtime/domain/runtime-host.types'
import type { AnyRuntimeHost } from '@/modules/runtime/domain/runtime-strategy.types'

/** Допустимая ссылка на зарегистрированный родительский runtime-host. */
export type RuntimeParentRef = AnyRuntimeHost | string

/** Публичная ссылка на зарегистрированный runtime app scope без зависимости Domain от Model. */
export interface RuntimeAppScopeReference {
  readonly id: string
}

/** Типизированные параметры создания runtime-host. */
export interface RuntimeExecuteOptions {
  /** Явный runtime-id вместо автоматически выделенного адреса. */
  id?: string

  /** Локальный id экземпляра внутри app scope. */
  instanceId?: string

  /** Зарегистрированный родительский host или его runtime-id. */
  parent?: RuntimeParentRef | null

  /** App scope или id зарегистрированного app scope. */
  appScope?: RuntimeAppScopeReference | string

  /** Read-only источник compiled artifacts. */
  artifactReader?: RuntimeArtifactReader

  /** Политика persistence для runtime state. */
  persistence?: EndgePersistenceDriver

  /** Стабильный storage-id для persisted runtime state. */
  persistenceKey?: string

  /** Strategy-specific metadata, не участвующая в создании runtime tree. */
  meta?: Record<string, unknown>
}

/** Параметры запуска host через конкретный app scope. */
export type RuntimeAppScopeExecuteOptions = Omit<RuntimeExecuteOptions, 'appScope'>
