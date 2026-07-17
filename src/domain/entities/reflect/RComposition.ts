import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'

import { Serialize } from '@endge/utils'
import { Exclude, Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'

export const R_COMPOSITION_KINDS = [
  'library',
  'query',
  'workspace',
  'tenant',
  'project',
  'environment',
] as const

export type RCompositionKind = typeof R_COMPOSITION_KINDS[number]

export function normalizeRCompositionKind(value: unknown): RCompositionKind {
  const normalized = String(value ?? '').trim().toLowerCase()
  return (R_COMPOSITION_KINDS as readonly string[]).includes(normalized)
    ? normalized as RCompositionKind
    : 'library'
}

export function normalizeRCompositionKindIdentity(value: unknown): string | null {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

/** Persisted source-first описание runtime-графа без layout/rendering. */
export class RComposition extends REntity {
  @Exclude()
  readonly type = 'composition' as const

  @Expose()
  description: string | null = null

  /** Presentation-владелец Composition; runtime semantics пока не меняет. */
  @Expose()
  kind: RCompositionKind = 'library'

  /** Identity конкретной сущности kind-владельца. Для query может отсутствовать. */
  @Expose()
  kindIdentity: string | null = null

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  static fromPlain(input: Record<string, unknown>): RComposition {
    const composition = Serialize.fromJSON(RComposition, input)
    composition.kind = normalizeRCompositionKind(input.kind)
    composition.kindIdentity = normalizeRCompositionKindIdentity(input.kindIdentity)
    return composition
  }

  override duplicate(options: DuplicateOptions): RComposition {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RComposition, plain)
  }
}
