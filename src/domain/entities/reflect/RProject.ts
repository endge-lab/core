// RProject.ts
import { Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'

function normalizeRelationId(value: unknown): number | null {
  if (value == null)
    return null
  if (typeof value === 'number')
    return Number.isFinite(value) ? value : null
  const text = String(value).trim()
  if (!text)
    return null
  const id = Number(text)
  return Number.isFinite(id) ? id : null
}

function normalizeRelationIds(value: unknown): number[] {
  const source = Array.isArray(value) ? value : (value != null ? [value] : [])
  const out: number[] = []
  for (const item of source) {
    const id = normalizeRelationId(item)
    if (id != null)
      out.push(id)
  }
  return Array.from(new Set(out))
}

/**
 * Доменная сущность для проекта (projects).
 *
 * Схема (schema-часть):
 *  - id: string            // identity или строковый id
 *  - identity: string
 *  - name: string
 *  - displayName: string
 *  - extendSettings: boolean
 *
 * Storage-мета (через REntity.applyStorageMeta):
 *  - createdAt, updatedAt, deletedAt, author, active
 */
export class RProject extends REntity {
  /** Отображаемое имя проекта */
  @Expose()
  displayName!: string

  /** Наследоваться ли от базовых настроек */
  @Expose()
  extendSettings: boolean = true

  /** Описание проекта */
  @Expose()
  description?: string | null = null

  /** Slug (URL-имя) */
  @Expose()
  slug?: string | null = null

  /** Порядок сортировки в списке */
  @Expose()
  order?: number | null = null

  /** Id профиля настроек (relationship → settings) */
  @Expose()
  settingsId?: number | null = null

  /** Id навигации (relationship → navigations) */
  @Expose()
  navigationId?: number | null = null

  /** Список разрешённых окружений проекта (relationship[] → environments). */
  @Expose()
  allowedEnvironmentIds: number[] = []

  /**
   * Создание проекта из payload-документа:
   *
   * {
   *   id: number,
   *   identity: string,
   *   displayName: string,
   *   "extend-settings": boolean,
   *   deletedAt?: string | null,
   *   author?: string,
   *   createdAt?: string,
   *   updatedAt?: string,
   *   ...
   * }
   */
  static fromPayload(json: any): RProject {
    const p = new RProject()

    // SCHEMA FIELDS
    p.id = json.id
    p.identity = json.identity ?? ''
    p.name = json.displayName ?? p.identity
    p.displayName = json.displayName ?? p.name
    // Проект не лежит в папке
    p.folderId = null

    p.extendSettings =
      json['extend-settings'] !== undefined
        ? Boolean(json['extend-settings'])
        : true
    p.description = json.description ?? null
    p.slug = json.slug ?? null
    p.order = json.order != null ? Number(json.order) : null
    p.settingsId = normalizeRelationId(json.settings ?? json.settingsId ?? null)
    p.navigationId = normalizeRelationId(json.navigation ?? json.navigationId ?? null)
    p.allowedEnvironmentIds = normalizeRelationIds(json.allowedEnvironments ?? json.allowedEnvironmentIds ?? [])

    // STORAGE META
    p.applyStorageMeta(json)

    return p
  }

  /**
   * Создание проекта из plain-схемы (schema.toPlain()).
   *
   * Ожидается структура:
   * {
   *   id: string
   *   identity?: string
   *   name?: string
   *   displayName?: string
   *   folder?: string | null
   *   extendSettings?: boolean
   * }
   */
  static fromPlain(json: any): RProject {
    const p = new RProject()

    p.id = json.id
    p.identity = json.identity ?? ''
    p.name = json.name ?? json.displayName ?? p.identity
    p.displayName = json.displayName ?? p.name
    p.folderId = json.folderId ?? json.folder ?? null
    p.extendSettings =
      json.extendSettings !== undefined ? Boolean(json.extendSettings) : true
    p.description = json.description ?? null
    p.slug = json.slug ?? null
    p.order = json.order != null ? Number(json.order) : null
    p.settingsId = normalizeRelationId(json.settingsId ?? json.settings ?? null)
    p.navigationId = normalizeRelationId(json.navigationId ?? json.navigation ?? null)
    p.allowedEnvironmentIds = normalizeRelationIds(json.allowedEnvironmentIds ?? json.allowedEnvironments ?? [])

    return p
  }

  /**
   * Экспорт только схемы (без storage-меты).
   * Используется в EndgeDomain.toPlain().
   */
  toPlain(): any {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      folderId: this.folderId ?? null,
      extendSettings: this.extendSettings,
      description: this.description ?? null,
      slug: this.slug ?? null,
      order: this.order ?? null,
      settingsId: this.settingsId ?? null,
      navigationId: this.navigationId ?? null,
      allowedEnvironmentIds: [...(this.allowedEnvironmentIds ?? [])],
    }
  }

  compile(): void {
    this.clearValidationErrors()

    if (!this.id) {
      this.addValidationError('Project.id не задан')
    }
    if (!this.identity) {
      this.addValidationError('Project.identity не задан')
    }
    if (!this.name) {
      this.addValidationError('Project.name не задан')
    }
    // Пока без жёстких ошибок, просто собираем validationErrors
  }
}
