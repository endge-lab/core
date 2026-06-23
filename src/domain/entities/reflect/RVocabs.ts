import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

export type RVocabMode = 'external_payload' | 'internal'

/** Сущность словаря (коллекция vocabs). Один документ = один словарь. */
export class RVocabs extends REntity {
  @Expose()
  displayName!: string

  @Expose()
  description?: string | null = null

  @Expose()
  mode: RVocabMode = 'internal'

  @Expose()
  baseApiUrl?: string | null = null

  @Expose()
  collectionSlug?: string | null = null

  @Expose()
  override active: boolean = true

  static fromPayload(json: any): RVocabs {
    const v = new RVocabs()
    v.id = json.id
    v.identity = json.identity ?? ''
    v.name = json.displayName ?? v.identity
    v.displayName = json.displayName ?? v.name
    v.description = json.description ?? null
    v.mode = json.mode === 'internal' ? 'internal' : 'external_payload'
    v.baseApiUrl = json.baseApiUrl ?? null
    v.collectionSlug = json.collectionSlug ?? null
    v.folderId = json.folder?.id ?? json.folder ?? null
    v.active = json.active !== false
    v.applyStorageMeta(json)
    return v
  }

  static fromPlain(json: any): RVocabs {
    const v = new RVocabs()
    v.id = json.id
    v.identity = json.identity ?? ''
    v.name = json.name ?? json.displayName ?? v.identity
    v.displayName = json.displayName ?? v.name
    v.description = json.description ?? null
    v.mode = json.mode === 'internal' ? 'internal' : 'external_payload'
    v.baseApiUrl = json.baseApiUrl ?? null
    v.collectionSlug = json.collectionSlug ?? null
    v.folderId = json.folderId ?? json.folder ?? null
    v.active = json.active !== false
    v.meta = (json.meta && typeof json.meta === 'object' && !Array.isArray(json.meta)) ? json.meta : {}
    return v
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description ?? null,
      mode: this.mode,
      baseApiUrl: this.baseApiUrl ?? null,
      collectionSlug: this.collectionSlug ?? null,
      folderId: this.folderId ?? null,
      active: this.active !== false,
      meta: this.meta ?? {},
    }
  }

  override compile(): void {
    this.clearValidationErrors()

    if (!String(this.identity ?? '').trim())
      this.addValidationError('Vocabs.identity не задан')
    if (!String(this.displayName ?? '').trim())
      this.addValidationError('Vocabs.displayName не задан')

    if (this.mode === 'external_payload') {
      if (!String(this.baseApiUrl ?? '').trim())
        this.addValidationError('Vocabs.baseApiUrl не задан для mode=external_payload')
      if (!String(this.collectionSlug ?? '').trim())
        this.addValidationError('Vocabs.collectionSlug не задан для mode=external_payload')
    }
  }

  override duplicate(options: DuplicateOptions): RVocabs {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RVocabs, plain)
  }
}
