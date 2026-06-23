export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Опции запроса (минимальный набор).
 */
export interface RequestOptions {
  /** Доп. заголовки */
  headers?: Record<string, string>
  /** Тело запроса; объект будет сериализован в JSON */
  body?: unknown
  /** AbortSignal для отмены */
  signal?: AbortSignal
  /** Query-параметры */
  query?: Record<string, string | number | boolean | null | undefined>
}

/**
 * Описание одного эндпоинта сервиса.
 */
export interface EndpointDescriptor {
  method: HttpMethod
  path: string // напр. '/select'
  options?: Omit<RequestOptions, 'body'> // дефолтные опции для эндпоинта (без body)
}

/**
 * Описание сервиса: базовый путь и набор эндпоинтов.
 */
export interface ServiceDescriptor {
  basePath?: string // напр. '/schedule'
  endpoints: Record<string, EndpointDescriptor>
}
