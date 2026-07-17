import type { EndgeExecutionContext } from '@/domain/types/configuration'

/**
 * Источник получения доменных данных
 * default - работа с внешним сервисом backend
 * payload - @Deprecated внешний сервис на payload
 * plain - данные подтягиваются из файла
 */
export type EndgeDataProvider =
  | 'default'
  | 'payload'
  | 'plain'

/**
 * Конфигурация загрузки движка
 * Определяет workspace, данные которого должны быть активированы из Payload.
 * Tenant, project и environment передаются отдельно через EndgeBootContext.context.
 */
export interface EndgeLoadScope {
  workspaceIdentity?: string
}

export interface EndgePayloadProviderOptions {
  baseAPI: string
  secret: string
}

export interface EndgeBootContext {
  /**
   * Источник получения доменных данных
   */
  dataProvider: EndgeDataProvider

  /**
   * Граница загружаемых данных.
   */
  scope: EndgeLoadScope

  /** Structural context immutable for one complete boot/build lifecycle. */
  context?: Partial<EndgeExecutionContext>

  /**
   * Runtime/env vars, которые нужны ядру.
   */
  vars: Record<string, unknown>

  /**
   * Для plain provider.
   */
  plainSource?: unknown

  /**
   * Для payload provider.
   */
  payload?: EndgePayloadProviderOptions

  /**
   * Для отмены долгой загрузки/сборки.
   */
  signal?: AbortSignal
}
