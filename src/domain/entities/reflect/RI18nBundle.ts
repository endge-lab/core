import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import type { DiagnosticsProblemInput } from '@/domain/types/diagnostics'
import { REntity } from '@/domain/entities/reflect/REntity'

/** Дерево сообщений по локали (формат vue-i18n). */
export type RI18nBundleLocales = Record<string, Record<string, unknown>>

/** Сущность словаря переводов (коллекция i18n-bundles). Один документ = словарь с несколькими локалями. */
export class RI18nBundle extends REntity {
  @Expose()
  displayName!: string

  @Expose()
  description?: string | null = null

  /** По коду локали (ru, en) — дерево ключ→значение. */
  @Expose()
  locales: RI18nBundleLocales = {}

  @Expose()
  override active: boolean = true

  static fromPayload(json: any): RI18nBundle {
    const v = new RI18nBundle()
    v.id = json.id
    v.identity = json.identity ?? ''
    v.name = json.displayName ?? v.identity
    v.displayName = json.displayName ?? v.name
    v.description = json.description ?? null
    v.locales = (json.locales && typeof json.locales === 'object' && !Array.isArray(json.locales)) ? json.locales : {}
    v.folderId = json.folder?.id ?? json.folder ?? null
    v.active = json.active !== false
    v.applyStorageMeta(json)
    return v
  }

  static fromPlain(json: any): RI18nBundle {
    const v = new RI18nBundle()
    v.id = json.id
    v.identity = json.identity ?? ''
    v.name = json.name ?? json.displayName ?? v.identity
    v.displayName = json.displayName ?? v.name
    v.description = json.description ?? null
    v.locales = (json.locales && typeof json.locales === 'object' && !Array.isArray(json.locales)) ? json.locales : {}
    v.folderId = json.folderId ?? json.folder ?? null
    v.active = json.active !== false
    return v
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description ?? null,
      locales: this.locales ?? {},
      folderId: this.folderId ?? null,
      active: this.active !== false,
    }
  }

  /** Возвращает validation problems i18n bundle без mutable entity state. */
  override getDiagnosticProblems(): DiagnosticsProblemInput[] {
    const problems: DiagnosticsProblemInput[] = []
    if (!String(this.identity ?? '').trim())
      problems.push({ severity: 'warning', code: 'i18n-bundle.identity.required', message: 'I18nBundle.identity не задан' })
    if (!String(this.displayName ?? '').trim())
      problems.push({ severity: 'warning', code: 'i18n-bundle.display-name.required', message: 'I18nBundle.displayName не задан' })
    return problems
  }

  override duplicate(options: DuplicateOptions): RI18nBundle {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RI18nBundle, plain)
  }
}
