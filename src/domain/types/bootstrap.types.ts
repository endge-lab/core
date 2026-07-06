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
 * Сейчас пустой, потому что configurator грузит полный snapshot.
 * Позже сюда добавятся tenantId/projectId/environmentId/entrypoint.
 */
export interface EndgeLoadScope {}

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
