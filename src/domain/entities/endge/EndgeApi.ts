import type { AxiosInstance } from 'axios'
import axios, { isAxiosError, type AxiosRequestConfig } from 'axios'
import type {
  HttpMethod,
  RequestOptions,
  ServiceDescriptor,
} from '@/domain/types/api.types'

export function makeForm(data: Record<string, unknown>): URLSearchParams {
  const form = new URLSearchParams()
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && v !== undefined) form.append(k, String(v))
  }
  return form
}

/**
 * Лёгкая axios-обёртка: JSON по умолчанию, query/headers/abort, генератор сервисов.
 */
export class EndgeApi {
  private readonly client: AxiosInstance

  constructor(
    baseUrl: string,
    private defaultHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  ) {
    this.client = axios.create({
      baseURL: baseUrl,
      headers: this.defaultHeaders,
    })
  }

  /** При необходимости можно динамически добавить/переопределить заголовки по умолчанию */
  setDefaultHeaders(next: Record<string, string>) {
    this.defaultHeaders = { ...this.defaultHeaders, ...next }
    Object.assign(this.client.defaults.headers, this.defaultHeaders)
  }

  /** Базовый метод запроса (axios.request) */
  async request<T>(
    method: HttpMethod,
    path: string,
    opts: RequestOptions = {},
  ): Promise<T> {
    const cfg: AxiosRequestConfig = {
      url: path, // относительный путь - базовый URL уже в инстансе
      method,
      headers: { ...this.defaultHeaders, ...(opts.headers ?? {}) },
      data: opts.body ?? undefined,
      params: opts.query ?? undefined,
      signal: opts.signal,
      // responseType оставляем по умолчанию; axios сам распарсит JSON
    }

    try {
      const res = await this.client.request<T>(cfg)
      // 204 вернёт undefined - приведём к null для совместимости с старой сигнатурой при необходимости
      return (res.data ?? (res.status === 204 ? (null as T) : res.data)) as T
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status
        const statusText = err.response?.statusText ?? 'AxiosError'
        const payload = err.response?.data
        const text =
          typeof payload === 'string' ? payload : JSON.stringify(payload ?? {})
        throw new Error(`HTTP ${status ?? 'ERR'} ${statusText}\n${text}`)
      }
      throw err
    }
  }

  // Шорткаты
  get<T>(path: string, opts?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('GET', path, opts)
  }
  post<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('POST', path, { ...opts, body })
  }
  put<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('PUT', path, { ...opts, body })
  }
  patch<T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('PATCH', path, { ...opts, body })
  }
  delete<T>(path: string, opts?: Omit<RequestOptions, 'body'>) {
    return this.request<T>('DELETE', path, opts)
  }

  /**
   * Генератор сервиса: по декларации возвращает объект с методами-эндпоинтами.
   */
  service<T extends Record<string, any>>(descriptor: ServiceDescriptor): T {
    const { basePath = '', endpoints } = descriptor
    const svc: Record<string, any> = {}

    for (const [name, ep] of Object.entries(endpoints)) {
      svc[name] = (body?: unknown, options?: RequestOptions) => {
        const merged: RequestOptions = {
          ...(ep.options ?? {}),
          ...(options ?? {}),
          body,
        }
        return this.request(ep.method, `${basePath}${ep.path}`, merged)
      }
    }
    return svc as T
  }
}
