import type { RuntimeAppScope } from '@/domain/entities/runtime/RuntimeAppScope'
import type { EndgePersistenceDriver } from '@/domain/types/runtime/context-persistence.types'
import type { RuntimeArtifactReader } from '@/domain/types/runtime/runtime-host.types'
import type { AnyRuntimeHost } from '@/domain/types/runtime/runtime-strategy.types'

/** Допустимая ссылка на зарегистрированный родительский runtime-host. */
export type RuntimeParentRef = AnyRuntimeHost | string

/** Типизированные параметры создания runtime-host. */
export interface RuntimeExecuteOptions {
  /** Явный runtime-id вместо автоматически выделенного адреса. */
  id?: string

  /** Локальный id экземпляра внутри app scope. */
  instanceId?: string

  /** Зарегистрированный родительский host или его runtime-id. */
  parent?: RuntimeParentRef | null

  /** App scope или id зарегистрированного app scope. */
  appScope?: RuntimeAppScope | string

  /** Помечает host корнем runtime tree внутри app scope. */
  scopeRoot?: boolean

  /** Read-only источник compiled artifacts. */
  artifactReader?: RuntimeArtifactReader

  /** Политика persistence для runtime state. */
  persistence?: EndgePersistenceDriver

  /** Стабильный storage-id для persisted runtime state. */
  persistenceKey?: string

  /** Strategy-specific metadata, не участвующая в создании runtime tree. */
  meta?: Record<string, unknown>
}

/** Параметры запуска root host через конкретный app scope. */
export type RuntimeAppScopeExecuteOptions = Omit<RuntimeExecuteOptions, 'appScope' | 'scopeRoot'>
