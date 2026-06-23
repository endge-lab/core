import { Expose } from 'class-transformer'
import { RQuery } from './RQuery'
import type { HttpMethod } from '@/domain/types/query.types'

export class RQueryRest extends RQuery {
  /** HTTP-метод (по умолчанию POST) */
  @Expose()
  method: HttpMethod = 'POST'

  /** Заголовки по умолчанию для этого запроса */
  @Expose()
  headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  }

  /** Таймаут HTTP-запроса в миллисекундах (опционально) */
  @Expose()
  timeoutMs?: number

  /**
   * Режим сериализации тела:
   * - false: тело как JSON (по умолчанию)
   * - true: тело как application/x-www-form-urlencoded (URLSearchParams)
   */
  @Expose()
  sendAsFormUrlencoded: boolean = false

  /**
   * Проверка конфигурации на этапе компиляции домена.
   * (вызывается EndgeDomain.compile()).
   */
  compile(): void {
    super.compile()
    if (!this.endpoint) {
      throw new Error(
        `RQueryRest.compile: "path" is required for "${this.name}"`,
      )
    }
    const allowed = new Set<HttpMethod>([
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
    ])
    if (!allowed.has(this.method)) {
      throw new Error(
        `RQueryRest.compile: unsupported method "${this.method}" in "${this.name}"`,
      )
    }
    // Подправим заголовок под form-url-encoded при необходимости
    if (this.sendAsFormUrlencoded) {
      this.headers = {
        ...this.headers,
        'Content-Type': 'application/x-www-form-urlencoded',
      }
    }
  }
}
