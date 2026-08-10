import type { EndgeExecutionContext } from '@/domain/types/runtime/execution-context.types'
import type { EndgeAuthBootOptions } from '@/domain/types/auth/auth-profile.types'
import type { EndgeDomainProvider } from '@/domain/types/document/domain-provider.type'
import type { EndgeDomainBundle } from '@/domain/types/document/domain-export.type'

/**
 * Источник получения доменных данных
 * default - работа с внешним сервисом backend
 * bundle - read-only работа с переносимым workspace snapshot
 * plain - данные подтягиваются из файла
 */
export type EndgeDataProvider =
  | 'default'
  | 'bundle'
  | 'plain'

/**
 * Конфигурация загрузки движка
 * Определяет workspace, данные которого должны быть активированы из persisted Domain.
 * Tenant, project и environment передаются отдельно через EndgeBootContext.context.
 */
export interface EndgeLoadScope {
  workspaceIdentity?: string
}

export interface EndgeUIBootOptions {
  /** Host-local fallback order when the configured adapter implementation is unavailable. */
  adapterFallbackIds?: readonly string[]
}

export interface EndgeBootContext {
  /**
   * Источник получения доменных данных
   */
  dataProvider: EndgeDataProvider

  /**
   * Граница загружаемого persisted Domain.
   */
  scope: EndgeLoadScope

  /** Structural context immutable for one complete boot/build lifecycle. */
  context?: Partial<EndgeExecutionContext>

  /**
   * Runtime/env vars, которые нужны ядру.
   */
  vars: Record<string, unknown>

  /** Host-local UI policy; it does not mutate persisted Workspace configuration. */
  ui?: EndgeUIBootOptions

  /** Host-owned resolver credential material for AuthProfile references. */
  auth?: EndgeAuthBootOptions

  /**
   * Для plain provider.
   */
  plainSource?: unknown

  /** Внешний источник live snapshot для default backend provider. */
  domainProvider?: EndgeDomainProvider

  /** Переносимый read-only workspace snapshot для bundle provider. */
  bundleSource?: EndgeDomainBundle

  /**
   * Для отмены долгой загрузки/сборки.
   */
  signal?: AbortSignal
}
