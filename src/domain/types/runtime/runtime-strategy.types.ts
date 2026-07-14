import type { RuntimeEntityType } from './runtime-entity-map.types'
import type { RuntimeArtifactReader, RuntimeHost } from './runtime-host.types'

export type RuntimeStrategyMeta = Record<string, any>
export type AnyRuntimeHost = RuntimeHost<any, any>

/** Контекст создания runtime-host конкретной стратегией. */
export interface RuntimeCreateContext<TModel = unknown> {
  /** Уникальный runtime-id, выделенный EndgeRuntime. */
  id: string

  /** Доменная модель, для которой создается runtime-host. */
  model: TModel

  /** Runtime meta/options без служебного parent. */
  meta: RuntimeStrategyMeta

  /** Родительский runtime-host, если запуск вложенный. */
  parent: AnyRuntimeHost | null

  /** Read-only доступ к compiled artifacts текущей Endge.program. */
  artifacts: RuntimeArtifactReader
}

/** Контекст разрушения runtime-host, если стратегии нужна своя очистка. */
export interface RuntimeDestroyContext<THost extends AnyRuntimeHost = AnyRuntimeHost> {
  /** Разрушаемый runtime-host. */
  host: THost
}

/** Strategy запуска runtime-сущности одного типа. */
export interface RuntimeStrategy<
  TModel = unknown,
  THost extends AnyRuntimeHost = AnyRuntimeHost,
> {
  /** Стабильный id стратегии для debug/плагинов. */
  id: string

  /** Канонический runtime entity type, который создает стратегия. */
  entityType: RuntimeEntityType

  /** Проверяет, умеет ли стратегия запустить переданную модель. */
  supports: (model: unknown) => model is TModel

  /** Создает runtime-host. Регистрация в EndgeRuntime здесь не выполняется. */
  create: (ctx: RuntimeCreateContext<TModel>) => THost | null

  /** Выполняет strategy-specific cleanup перед общим host.destroy(). */
  destroy?: (ctx: RuntimeDestroyContext<THost>) => void
}

export type AnyRuntimeStrategy = RuntimeStrategy<any, any>
