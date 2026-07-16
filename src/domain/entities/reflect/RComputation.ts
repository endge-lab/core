import { Serialize } from '@endge/utils'
import { Expose, Type } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'
import { RField } from '@/domain/entities/reflect/RField'

/** Persisted executable specification. Runtime execution is provided separately. */
export class RComputation extends REntity {
  @Expose()
  override displayName: string = ''

  @Expose()
  override description: string | null = null

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  @Expose()
  contractVersion: number = 1

  @Expose()
  @Type(() => RField)
  input: RField | null = null

  @Expose()
  @Type(() => RField)
  output: RField | null = null

  static fromPayload(json: any): RComputation {
    return RComputation.fromPlain({
      ...json,
      name: json?.displayName ?? json?.name,
      folderId: relationToId(json?.folder ?? json?.folderId),
      project: relationToId(json?.project) ?? null,
    }, json)
  }

  static fromPlain(json: any, storageMeta?: any): RComputation {
    const computation = new RComputation()
    computation.id = json?.id
    computation.identity = String(json?.identity ?? '').trim()
    computation.name = String(json?.name ?? json?.displayName ?? computation.identity)
    computation.displayName = String(json?.displayName ?? computation.name)
    computation.description = json?.description ?? null
    computation.source = typeof json?.source === 'string' ? json.source : ''
    computation.sourceVersion = Math.max(1, Number(json?.sourceVersion ?? 1) || 1)
    computation.contractVersion = Math.max(1, Number(json?.contractVersion ?? 1) || 1)
    computation.input = fieldFromPlain(json?.input, 'input')
    computation.output = fieldFromPlain(json?.output, 'output')
    computation.folderId = json?.folderId ?? relationToId(json?.folder) ?? null
    computation.project = (relationToId(json?.project) ?? null) as any
    computation.meta = isPlainObject(json?.meta) ? { ...json.meta } : {}
    computation.active = json?.active !== false
    computation.inherited = json?.inherited === true
    computation.deletedAt = json?.deletedAt ?? null
    computation.author = json?.author ?? null
    if (storageMeta)
      computation.applyStorageMeta(storageMeta)
    return computation
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      source: this.source,
      sourceVersion: this.sourceVersion,
      contractVersion: this.contractVersion,
      input: fieldToPlain(this.input),
      output: fieldToPlain(this.output),
      folderId: this.folderId ?? null,
      project: this.project ?? null,
      meta: this.meta ?? {},
      active: this.active !== false,
      inherited: this.inherited === true,
      deletedAt: this.deletedAt ?? null,
      author: this.author ?? null,
    }
  }

  override compile(): void {
    this.clearValidationErrors()
    if (!this.identity)
      this.addValidationError('Computation.identity не задан')
    if (!this.displayName)
      this.addValidationError('Computation.displayName не задан')
    if (!this.source.trim())
      this.addValidationError('Computation.source не задан')
  }

  override duplicate(options: DuplicateOptions): RComputation {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.id = undefined
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return RComputation.fromPlain(plain)
  }
}

function relationToId(value: any): string | number | null {
  if (value == null)
    return null
  if (typeof value === 'object')
    return relationToId(value.id ?? value.value)
  return value
}

function fieldFromPlain(value: any, name: string): RField | null {
  const type = relationToId(value?.type)
  if (type == null || String(type).trim() === '')
    return null
  return new RField(name, String(type), value?.isArray === true, value?.optional === true)
}

function fieldToPlain(field: RField | null): Record<string, unknown> | null {
  return field
    ? { type: field.type, isArray: field.isArray === true, optional: field.optional === true }
    : null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
