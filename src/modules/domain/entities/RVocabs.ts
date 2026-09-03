import type { DiagnosticsProblemInput } from '@/modules/diagnostics/domain/types/diagnostics.types'
import type { DuplicateOptions } from '@/modules/domain/entities/REntity'

import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'
import { REntity } from '@/modules/domain/entities/REntity'
import { VOCAB_DEFAULT_SOURCE } from '@/modules/source/templates/vocab.default.source'

export type RVocabMode = 'external_payload' | 'internal'

/** Сущность словаря (коллекция vocabs). Один документ = один словарь. */
export class RVocabs extends REntity {
  @Expose()
  sourceVersion: number = 1

  @Expose()
  source: string = VOCAB_DEFAULT_SOURCE

  @Expose()
  override description: string | null = null

  @Expose()
  mode: RVocabMode = 'internal'

  @Expose()
  baseApiUrl?: string | null = null

  @Expose()
  collectionSlug?: string | null = null

  @Expose()
  override active: boolean = true

  @Expose()
  authMode: 'inherit' | 'profile' | 'none' = 'inherit'

  @Expose()
  authProfileIdentity?: string | null = null

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
    v.sourceVersion = Number(json.sourceVersion ?? 1) || 1
    v.source = String(json.source ?? '').trim() || createLegacyVocabSource({
      mode: v.mode,
      baseApiUrl: v.baseApiUrl,
      collectionSlug: v.collectionSlug,
      authMode: v.authMode,
      authProfileIdentity: v.authProfileIdentity,
    })
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
      sourceVersion: this.sourceVersion,
      source: this.source,
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
    if (!String(this.identity ?? '').trim()) {
      problems.push({ severity: 'warning', code: 'vocab.identity.required', message: 'Vocabs.identity не задан' })
    }
    if (!String(this.displayName ?? '').trim()) {
      problems.push({ severity: 'warning', code: 'vocab.display-name.required', message: 'Vocabs.displayName не задан' })
    }

    if (this.sourceVersion !== 1) {
      problems.push({ severity: 'error', code: 'vocab.source-version.unsupported', message: `Vocab sourceVersion=${this.sourceVersion} не поддерживается` })
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

export function createLegacyVocabSource(input: {
  mode: RVocabMode
  baseApiUrl?: string | null
  collectionSlug?: string | null
  authMode?: 'inherit' | 'profile' | 'none'
  authProfileIdentity?: string | null
}): string {
  if (input.mode !== 'external_payload') {
    return VOCAB_DEFAULT_SOURCE
  }

  const rawBaseUrl = String(input.baseApiUrl ?? '').trim()
  const environment = rawBaseUrl.match(/^\{([A-Z_]\w*)\}$/i)?.[1]
  const baseUrl = environment ? `env(${quote(environment)})` : quote(rawBaseUrl)
  const collection = quote(String(input.collectionSlug ?? '').trim())
  const auth = input.authMode === 'profile'
    ? `{ mode: 'profile', profile: ${quote(String(input.authProfileIdentity ?? '').trim())} }`
    : `{ mode: '${input.authMode === 'none' ? 'none' : 'inherit'}' }`

  return `defineVocab({
  provider: payload({
    baseUrl: ${baseUrl},
    collection: ${collection},
    auth: ${auth},
  }),

  outputs: {
    items: output()
      .from(response()),
  },
})
`
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

function normalizeVocabAuthMode(value: unknown): 'inherit' | 'profile' | 'none' {
  const mode = String(value ?? '').trim()
  if (mode === 'profile' || mode === 'none') {
    return mode
  }
  if (mode && mode !== 'inherit') {
    throw new Error(`[RVocabs] Unsupported authMode: ${mode}`)
  }
  return 'inherit'
}
