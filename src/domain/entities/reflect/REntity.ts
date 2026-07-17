import { Exclude, Expose } from 'class-transformer'

/** Опции для дублирования сущности: новый identity и опционально имя. */
export interface DuplicateOptions {
  identity: string
  name?: string
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

  /** Системный документ (нельзя редактировать/сохранять в редакторе) */
  @Expose()
  isSystem: boolean = false

  /** Временная сущность runtime/editor, не должна отображаться как обычный документ домена. */
  @Exclude()
  isTemporary: boolean = false

  /** Произвольные метаданные (из Payload meta, по умолчанию {}). */
  @Expose()
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

  // Ошибки сущности на этапе компиляции
  @Exclude()
  protected validationErrors: string[] = []

  /**
   * Добавляет ошибку в массив (используется внутри наследников).
   */
  protected addValidationError(message: string): void {
    this.validationErrors.push(message)
  }

  /**
   * Очищает все ошибки.
   */
  protected clearValidationErrors(): void {
    this.validationErrors = []
  }

  /** Подмешивает storage-мета и meta из Payload */
  applyStorageMeta(raw: any): void {
    this.createdAt = raw.createdAt ?? undefined
    this.updatedAt = raw.updatedAt ?? undefined
    this.deletedAt = raw.deletedAt ?? null
    this.author = raw.author ?? null
    this.active = raw.active ?? null
    this.meta = (raw?.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) ? { ...raw.meta } : {}
  }

  compile(): void {
    this.validationErrors = []
  }

  /**
   * Возвращает полную копию сущности с новым identity и именем (в корне, folderId = null).
   * Переопределяется в наследниках для корректного глубокого копирования структуры.
   */
  duplicate(_options: DuplicateOptions): REntity {
    throw new Error(`duplicate() not implemented for ${this.constructor.name}`)
  }
}
