import type { EndgeAuthBootOptions } from '@/modules/auth/domain/types/auth-profile.types'
import type { EndgeDomainBundle } from '@/modules/domain/types/document/domain-export.type'
import type { EndgeDomainProvider } from '@/modules/domain/types/document/domain-provider.type'
import type { EndgeExecutionContext } from '@/modules/runtime/domain/execution-context.types'

/**
 * Источник получения доменных данных
 * default - работа с внешним сервисом backend
 * bundle - read-only работа с переносимым workspace snapshot
 * plain - данные подтягиваются из файла
 */
export type EndgeDataProvider
  = | 'default'
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
  /** Локальный для host порядок fallback, когда настроенная реализация адаптера недоступна. */
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

  /** Структурный контекст, неизменяемый в течение полного lifecycle запуска и сборки. */
  context?: Partial<EndgeExecutionContext>

  /**
   * Runtime/env vars, которые нужны ядру.
   */
  vars: Record<string, unknown>

  /** Локальная для host политика UI, не изменяющая сохранённую конфигурацию Workspace. */
  ui?: EndgeUIBootOptions

  /** Пространство имён браузерной сессии, принадлежащее host. */
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
