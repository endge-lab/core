import { Exclude, Expose } from 'class-transformer'

/**
 * Доменная сущность версии (снимок домена).
 * data подгружается только по требованию (скачивание).
 */
export class RVersion {
  /** Payload id (в Payload - число) */
  @Expose()
  id!: number

  @Expose()
  identity!: string

  @Expose()
  description: string = ''

  /** Данные домена (JSON). Заполняется только при запросе (скачать). */
  @Expose()
  data?: any

  @Exclude()
  createdAt?: string

  @Exclude()
  updatedAt?: string

  /** Заполнить из ответа API (без data для списка). */
  static fromPayload(doc: { id: string | number; identity?: string; description?: string; data?: any; createdAt?: string; updatedAt?: string }): RVersion {
    const v = new RVersion()
    v.id = doc.id
    v.identity = doc.identity ?? ''
    v.description = doc.description ?? ''
    if (doc.data !== undefined) v.data = doc.data
    v.createdAt = doc.createdAt
    v.updatedAt = doc.updatedAt
    return v
  }

  toPlain(): { id: string | number; identity: string; description: string; data?: any } {
    return {
      id: this.id,
      identity: this.identity,
      description: this.description,
      ...(this.data !== undefined && { data: this.data }),
    }
  }
}
