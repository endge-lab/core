/** Опции создания доменного черновика без регистрации и сохранения. */
export interface DocumentDraftOptions {
  /** Стабильный identity для repository и runtime registry. */
  identity: string

  /** Человекочитаемое имя; по умолчанию используется identity. */
  name?: string

  /** Необязательная связь с родительской папкой. */
  folderId?: string | number | null
}
