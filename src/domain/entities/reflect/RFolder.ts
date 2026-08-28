import { Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'

/**
 * Доменная сущность для папок (folders).
 *
 * Может быть создана:
 *  - из payload-формата (с полями id, identity, displayName...)
 *  - из plain-domain-формата (schema)
 */
export class RFolder extends REntity {
  /** Тип сущностей, для которых предназначена папка (canonical collection slug). */
  @Expose()
  entityType: string | null = null

  /** Id родительской папки (null если корень). */
  @Expose()
  parent: string | number | null = null

  /** Загружает папку из plain-schema (schema.toPlain()) */
  static fromPlain(json: any): RFolder {
    const f = new RFolder()

    f.id = json.id
    f.identity = json.identity ?? ''
    f.name = json.name
    f.displayName = json.displayName ?? json.name
    f.entityType = typeof json.entityType === 'string' && json.entityType.trim()
      ? json.entityType.trim()
      : null
    f.parent = json.parent ?? null
    f.folderId = null
    f.applyEntityMeta(json)

    return f
  }

  /** Экспорт только схемы (parent уже id в plain). */
  toPlain(): any {
    return {
      id: this.id,
      name: this.name,
      displayName: this.displayName,
      entityType: this.entityType,
      parent: this.parent,
      meta: { ...this.meta },
    }
  }

  compile(): void {
    /* nothing yet */
  }
}
