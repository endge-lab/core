/** Канонический тип source-документа, для которого выбирается source strategy. */
export type SourceKind = 'query' | 'data-view' | 'filter' | 'composition' | 'store' | 'computation' | 'style'

/** Тип нейтральной source completion без привязки к Monaco или другому editor API. */
export type SourceLanguageCompletionKind
  = | 'keyword'
    | 'function'
    | 'property'
    | 'value'
    | 'snippet'

/** Позиция курсора внутри source-документа. */
export interface SourceLanguagePosition {
  /** Номер строки, начиная с 1. */
  lineNumber: number

  /** Номер колонки, начиная с 1. */
  column: number
}

/** Контекст, который UI/editor adapter передает language strategy. */
export interface SourceLanguageContext {
  /** Текущий текст source-документа. */
  source: string

  /** Текущая позиция курсора, если она есть у editor adapter. */
  position?: SourceLanguagePosition
}

/** Нейтральная completion item, которую editor adapter мапит в свой формат. */
export interface SourceLanguageCompletion {
  /** Текст, отображаемый в списке подсказок. */
  label: string

  /** Семантический тип подсказки. */
  kind: SourceLanguageCompletionKind

  /** Текст, который нужно вставить. Может быть snippet-ом. */
  insertText: string

  /** Краткое описание справа от completion item. */
  detail?: string

  /** Документация completion item. */
  documentation?: string
}

/** Логический тип внешнего доменного документа, на который ссылается source. */
export type SourceDocumentReferenceTarget
  = | 'auth-profile'
    | 'component'
    | 'composition'
    | 'computation'
    | 'converter'
    | 'data-view'
    | 'filter'
    | 'mock'
    | 'query'
    | 'store'
    | 'style'
    | 'vocabs'

/** Семантическая ссылка из source на внешний доменный документ. */
export interface SourceDocumentReference {
  /** Логический тип цели; UI может уточнить concrete document type через domain. */
  target: SourceDocumentReferenceTarget

  /** Persisted identity целевого документа. */
  identity: string

  /** Полуоткрытый диапазон reference-expression в source offsets. */
  range: {
    start: number
    end: number
  }
}

/** Результат validation source language strategy. */
export interface SourceLanguageValidationResult extends SourceEngineResult {
  /** Diagnostics, найденные language strategy. */
  diagnostics: unknown[]
}

/** Минимальная операция source engine. Детальные операции появятся вместе с patch engine. */
export interface SourceEngineOperation {
  /** Тип операции, например replace-slot или insert-block. */
  type: string

  /** Дополнительный payload операции. */
  payload?: Record<string, unknown>
}

/** Базовый результат source operation до внедрения полноценного patch engine. */
export interface SourceEngineResult {
  /** Было ли действие обработано стратегией. */
  ok: boolean

  /** Машинное сообщение об ошибке или причине no-op. */
  message?: string
}

/** Результат генерации source из persisted/legacy модели. */
export interface SourceEngineGenerateResult extends SourceEngineResult {
  /** Сгенерированный source-документ. */
  source?: string

  /** Нормализованный source document, если стратегия его построила. */
  document?: unknown
}

/** Результат компиляции source в normalized document и runtime artifact payload. */
export interface SourceEngineCompileResult extends SourceEngineResult {
  /** Parser-level AST. */
  ast?: unknown

  /** Нормализованный source document. */
  document?: unknown

  /** Runtime/program-ready artifact payload. */
  artifact?: any

  /** Публичная metadata, извлечённая из source. */
  metadata?: import('@/domain/types/program/program-metadata.types').ProgramMetadataMap

  /** Diagnostics, найденные source compiler-ом. */
  diagnostics?: unknown[]
}

/** Результат parse source без обязательной runtime-компиляции. */
export interface SourceParseResult<TDocument = unknown> extends SourceEngineResult {
  /** Parser-level AST. */
  ast?: unknown

  /** Нормализованный source document. */
  document?: TDocument

  /** Diagnostics, найденные parser/compiler-ом. */
  diagnostics?: unknown[]
}

/** Результат patch source-документа. */
export interface SourcePatchResult<TDocument = unknown> extends SourceParseResult<TDocument> {
  /** Новый source-документ. */
  source: string

  /** Был ли source реально изменен. */
  changed: boolean
}

/** Strategy source patching для одного source-kind. */
export interface SourcePatchStrategy<TPatch = unknown, TDocument = unknown> {
  /** Стабильный id стратегии для debug/плагинов. */
  id: string

  /** Тип source-документа, который обслуживает стратегия. */
  sourceKind: SourceKind

  /** Проверяет, может ли стратегия обслужить переданный source-kind. */
  supports: (sourceKind: SourceKind | string) => boolean

  /** Парсит source в editor-facing normalized document. */
  parse: (source: string) => SourceParseResult<TDocument>

  /** Применяет минимальный patch, сохраняя остальной авторский source. */
  patch: (source: string, patch: TPatch) => SourcePatchResult<TDocument>
}

/** Strategy source engine для одного source-kind. */
export interface SourceEngineStrategy {
  /** Стабильный id стратегии для debug/плагинов. */
  id: string

  /** Тип source-документа, который обслуживает стратегия. */
  sourceKind: SourceKind

  /** Проверяет, может ли стратегия обслужить переданный source-kind. */
  supports: (sourceKind: SourceKind | string) => boolean

  /** Выполняет нейтральную source operation. Пока используется как будущий контракт patch/analyze API. */
  execute?: (operation: SourceEngineOperation) => SourceEngineResult

  /** Генерирует source из persisted/legacy модели. */
  generate?: (model: unknown) => SourceEngineGenerateResult

  /** Компилирует source в normalized document и artifact payload. */
  compile?: (source: string) => SourceEngineCompileResult
}

/** Нейтральный token pattern source-языка, не завязанный на Monaco API. */
export interface SourceLanguageTokenPattern {
  pattern: RegExp
  token: string
  next?: string
}

/** Editor-facing синтаксис, которым владеет SourceLanguageStrategy. */
export interface SourceLanguageSyntaxDefinition {
  aliases: string[]
  extensions: string[]
  comments: {
    lineComment: string
    blockComment: [string, string]
  }
  brackets: Array<[string, string]>
  autoClosingPairs: Array<{ open: string, close: string }>
  triggerCharacters: string[]
  tokenizer: Record<string, SourceLanguageTokenPattern[]>
}

/** Strategy source language для editor-facing операций одного source-kind. */
export interface SourceLanguageStrategy {
  /** Стабильный id стратегии для debug/плагинов. */
  id: string

  /** Тип source-документа, который обслуживает стратегия. */
  sourceKind: SourceKind

  /** Проверяет, может ли стратегия обслужить переданный source-kind. */
  supports: (sourceKind: SourceKind | string) => boolean

  /** Описывает подсветку, brackets и editor triggers в adapter-neutral формате. */
  syntax: SourceLanguageSyntaxDefinition

  /** Возвращает базовый source для новой сущности. */
  createDefaultSource: () => string

  /** Валидирует source без знания о конкретном editor adapter. */
  validate: (source: string) => SourceLanguageValidationResult

  /** Возвращает доступные подсказки языка в нейтральном формате. */
  completions: (context: SourceLanguageContext) => SourceLanguageCompletion[]

  /** Возвращает внешнюю document reference под курсором, если язык её поддерживает. */
  resolveReference?: (context: SourceLanguageContext) => SourceDocumentReference | null
}
