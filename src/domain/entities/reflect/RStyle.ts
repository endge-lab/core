import { Serialize } from '@endge/utils'
import { Exclude, Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'

/** Initial source-first EndgeCSS document. */
export const ENDGE_STYLE_DEFAULT_SOURCE = `/* EndgeCSS is renderer-neutral. */
* {
  --surface: #ffffff;
  --text: #111827;
}

@theme dark {
  --surface: #111827;
  --text: #f9fafb;
}
`

/** Persisted source-first EndgeCSS document without compiled/runtime state. */
export class RStyle extends REntity {
  @Exclude()
  readonly type = 'style' as const

  @Expose()
  override description: string | null = null

  @Expose()
  source: string = ENDGE_STYLE_DEFAULT_SOURCE

  @Expose()
  sourceVersion: number = 1

  static fromPayload(json: any): RStyle {
    return RStyle.fromPlain({
      ...json,
      name: json?.displayName ?? json?.name,
      folderId: relationToId(json?.folder ?? json?.folderId),
    }, json)
  }

  static fromPlain(json: any, storageMeta?: any): RStyle {
    const style = new RStyle()
    style.id = json?.id
    style.identity = String(json?.identity ?? '').trim()
    style.name = String(json?.name ?? json?.displayName ?? style.identity)
    style.displayName = String(json?.displayName ?? style.name)
    style.description = json?.description ?? null
    style.source = typeof json?.source === 'string' ? json.source : ENDGE_STYLE_DEFAULT_SOURCE
    style.sourceVersion = Math.max(1, Number(json?.sourceVersion ?? 1) || 1)
    style.folderId = json?.folderId ?? relationToId(json?.folder) ?? null
    style.meta = isPlainObject(json?.meta) ? { ...json.meta } : {}
    style.isSystem = json?.isSystem === true
    style.inherited = json?.inherited === true
    style.active = json?.active ?? null
    style.deletedAt = json?.deletedAt ?? null
    style.author = json?.author ?? null
    if (storageMeta)
      style.applyStorageMeta(storageMeta)
    return style
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName || this.name,
      description: this.description,
      source: this.source,
      sourceVersion: this.sourceVersion,
      folderId: this.folderId ?? null,
      meta: this.meta ?? {},
      active: this.active !== false,
      inherited: this.inherited === true,
      isSystem: this.isSystem === true,
      deletedAt: this.deletedAt ?? null,
      author: this.author ?? null,
    }
  }

  override duplicate(options: DuplicateOptions): RStyle {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return RStyle.fromPlain(plain)
  }
}

function relationToId(value: any): string | number | null {
  if (value == null)
    return null
  if (typeof value === 'object')
    return relationToId(value.id ?? value.value)
  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
