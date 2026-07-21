import { Exclude, Expose, Transform } from 'class-transformer'
import type { DiagnosticsProblemInput } from '@/domain/types/diagnostics'
import type { EntityManagement, EntityManagementLike, EntityOrigin, ManagedBy } from '@/domain/types/document/entity-management.type'
import { normalizeEntityManagement } from '@/domain/types/document/entity-management.type'

/** Опции для дублирования сущности: новый identity и опционально имя. */
export interface DuplicateOptions {
  identity: string
  name?: string
}

/** Нормализует произвольную metadata документа и разрывает ссылку на transport object. */
export function normalizeEntityMeta(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

export class REntity {
  /** Идентификатор в storage (Payload: number, plain: string | number) */
  @Expose()
  id!: number

  @Expose()
  identity!: string

  /** Человекочитаемое имя документа */
  @Expose()
  displayName!: string

  @Expose()
  name!: string

  @Expose()
  description: string | null = null

  // @Exclude()
  // get name() {
  //   return this.displayName
  // }
  //
  // @Exclude()
  // set name(v: string) {
  //   this.displayName = v
  // }

  /** Id папки, в которой расположен документ (связь по id). */
  @Expose()
  folderId?: string | number | null = null

  /** Кто управляет жизненным циклом документа. */
  @Expose()
  managedBy: ManagedBy = 'user'

  /** Источник effective entity; только storage-сущности сохраняются и экспортируются. */
  @Exclude()
  origin: EntityOrigin = { kind: 'storage' }

  /** Opaque installation ID; используется только для integration-managed документов. */
  @Expose()
  managedById: string | null = null

  /** Временная сущность runtime/editor, не должна отображаться как обычный документ домена. */
  @Exclude()
  isTemporary: boolean = false

  /** Произвольные метаданные (из Payload meta, по умолчанию {}). */
  @Expose()
  @Transform(({ value }) => normalizeEntityMeta(value), { toClassOnly: true })
  meta: Record<string, unknown> = {}

  //  STORAGE META (НЕ входят в экспорт схемы)

  @Exclude()
  createdAt?: string

  @Exclude()
  updatedAt?: string

  @Exclude()
  deletedAt?: string | null

  @Exclude()
  author?: string | null

  @Exclude()
  active?: boolean | null

  /** Применяет общий meta-контракт к transport/plain документу. */
  applyEntityMeta(raw: unknown): void {
    const source = raw != null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).meta
      : undefined
    this.meta = normalizeEntityMeta(source)
  }

  /** Подмешивает storage-мета и meta из Payload. */
  applyStorageMeta(raw: any): void {
    this.origin = { kind: 'storage' }
    this.applyManagement(raw)
    this.createdAt = raw.createdAt ?? undefined
    this.updatedAt = raw.updatedAt ?? undefined
    this.deletedAt = raw.deletedAt ?? null
    this.author = raw.author ?? null
    this.active = raw.active ?? null
    this.applyEntityMeta(raw)
  }

  applyManagement(raw: EntityManagement | Record<string, unknown> | null | undefined): void {
    const management = normalizeEntityManagement(raw as EntityManagementLike)
    this.managedBy = management.managedBy
    this.managedById = management.managedById
  }

  /** Возвращает текущие validation problems без сохранения mutable state в сущности. */
  getDiagnosticProblems(): DiagnosticsProblemInput[] {
    return []
  }

  /** Выполняет legacy compile hook без хранения validation state в сущности. */
  compile(): void {}

  /**
   * Возвращает полную копию сущности с новым identity и именем (в корне, folderId = null).
   * Переопределяется в наследниках для корректного глубокого копирования структуры.
   */
  duplicate(_options: DuplicateOptions): REntity {
    throw new Error(`duplicate() not implemented for ${this.constructor.name}`)
  }
}
