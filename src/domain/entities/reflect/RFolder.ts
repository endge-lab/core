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
  /** Отображаемое имя папки */
  @Expose()
  displayName!: string

  /** Тип сущностей, для которых предназначена папка (collection slug в Payload). */
  @Expose()
  entityType: string | null = null

  /** Id родительской папки (null если корень). */
  @Expose()
  parent: string | number | null = null

  /** Загружает папку из формата Payload */
  static fromPayload(json: any): RFolder {
    const f = new RFolder()

    // SCHEMA FIELDS
    f.id = json.id
    f.identity = json.identity ?? ''
    f.name = json.displayName ?? json.identity ?? ''
    f.displayName = json.displayName
    f.entityType = typeof json.entityType === 'string' && json.entityType.trim()
      ? json.entityType.trim()
      : null
    const parentId = json.parent != null && typeof json.parent === 'object' ? json.parent.id : json.parent
    f.parent = parentId ?? null
    f.folderId = null

    f.applyStorageMeta(json)

    return f
  }

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
    }
  }

  compile(): void {
    /* nothing yet */
  }
}
