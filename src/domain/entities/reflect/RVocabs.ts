import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import type { DiagnosticsProblemInput } from '@/domain/types/diagnostics'
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

  @Expose()
  authMode: 'inherit' | 'profile' | 'manual' | 'none' = 'inherit'

  @Expose()
  authProfileIdentity?: string | null = null

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
    v.authMode = normalizeVocabAuthMode(json.authMode)
    v.authProfileIdentity = json.authProfileIdentity ?? null
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
    v.authMode = normalizeVocabAuthMode(json.authMode)
    v.authProfileIdentity = json.authProfileIdentity ?? null
    v.folderId = json.folderId ?? json.folder ?? null
    v.active = json.active !== false
    v.applyEntityMeta(json)
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
      authMode: this.authMode ?? 'inherit',
      authProfileIdentity: this.authProfileIdentity ?? null,
      folderId: this.folderId ?? null,
      active: this.active !== false,
      meta: this.meta ?? {},
    }
  }

  /** Возвращает validation problems vocab без mutable entity state. */
  override getDiagnosticProblems(): DiagnosticsProblemInput[] {
    const problems: DiagnosticsProblemInput[] = []
    if (!String(this.identity ?? '').trim())
      problems.push({ severity: 'warning', code: 'vocab.identity.required', message: 'Vocabs.identity не задан' })
    if (!String(this.displayName ?? '').trim())
      problems.push({ severity: 'warning', code: 'vocab.display-name.required', message: 'Vocabs.displayName не задан' })

    if (this.mode === 'external_payload') {
      if (!String(this.baseApiUrl ?? '').trim())
        problems.push({ severity: 'warning', code: 'vocab.base-api-url.required', message: 'Vocabs.baseApiUrl не задан для mode=external_payload' })
      if (!String(this.collectionSlug ?? '').trim())
        problems.push({ severity: 'warning', code: 'vocab.collection-slug.required', message: 'Vocabs.collectionSlug не задан для mode=external_payload' })
    }
    return problems
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

function normalizeVocabAuthMode(value: unknown): 'inherit' | 'profile' | 'manual' | 'none' {
  const mode = String(value ?? '').trim()
  if (mode === 'profile' || mode === 'manual' || mode === 'none')
    return mode
  return 'inherit'
}
