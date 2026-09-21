import { Expose } from 'class-transformer'

import { REntity } from '@/features/core/modules/domain/entities/REntity'

/**
 * Доменная сущность для папок (folders).
 *
 * Может быть создана:
 *  - из payload-формата (с полями id, identity, displayName...)
 *  - из plain-domain-формата (schema)
 */
export class RFolder extends REntity {
  /** Проекция, которой принадлежит папка. */
  @Expose()
  scope: 'collection' | 'workspace' = 'collection'

  /** Тип сущностей, для которых предназначена папка (canonical collection slug). */
  @Expose()
  entityType: string | null = null

  /** Id родительской папки (null если корень). */
  @Expose()
  parent: string | number | null = null

  /** Опциональное пользовательское оформление Workspace-папки. */
  @Expose()
  icon: string | null = null

  @Expose()
  color: string | null = null

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
    f.scope = json.scope === 'workspace' ? 'workspace' : 'collection'
    f.parent = json.parent ?? null
    f.icon = typeof json.icon === 'string' && json.icon.trim() ? json.icon.trim() : null
    f.color = typeof json.color === 'string' && json.color.trim() ? json.color.trim() : null
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
      scope: this.scope,
      entityType: this.entityType,
      parent: this.parent,
      icon: this.icon,
      color: this.color,
      meta: { ...this.meta },
    }
  }

  compile(): void {
    /* пока пусто */
  }
}
