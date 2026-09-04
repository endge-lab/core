import type { I18nCatalogProvenance, I18nRuntimeCatalog } from '@/modules/i18n/domain/i18n.types'
import type { TypeSourceDefinition } from '@/modules/source/domain/types/type-source.types'

/** Канонический тип source-документа, для которого выбирается source strategy. */
export type SourceKind = 'action' | 'query' | 'vocab' | 'data-view' | 'filter' | 'composition' | 'store' | 'stream' | 'update' | 'computation' | 'style' | 'type' | 'configuration'

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

  /** Символы Type Registry на основе Source, доступные этому редактору. */
  typeSymbols?: Array<{
    identity: string
    displayName?: string
    category?: 'primitive' | 'reference' | 'user'
    definition?: TypeSourceDefinition | null
    entityReference?: { target: string, storage: 'id' | 'identity' }
  }>

  /** Каталог установленных определений storage и кода для completions identity. */
  documentSymbols?: Array<{
    target: SourceDocumentReferenceTarget
    identity: string
    displayName?: string
    description?: string | null
  }>

  /** Identity документа, владеющего текущей диагностикой Source. */
  ownerIdentity?: string

  /** Фактические каталоги переводов для всех текущих вхождений Project. */
  i18n?: SourceLanguageI18nContext
}

/** Одно статически спроецированное вхождение Composition в текущем Project. */
export interface SourceLanguageI18nOccurrence {
  id: string
  catalogsByScope: Readonly<Record<string, I18nRuntimeCatalog>>
  provenanceByScope: Readonly<Record<string, I18nCatalogProvenance>>
}

/** Вход переводов, подготовленный приложением без монтирования Runtime. */
export interface SourceLanguageI18nContext {
  locale: string
  fallbackLocale: string
  occurrences: readonly SourceLanguageI18nOccurrence[]
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

export interface SourceLanguageSignatureHelp {
  activeSignature: number
  activeParameter: number
  signatures: Array<{
    label: string
    documentation?: string
    parameters: Array<{ label: string, documentation?: string }>
  }>
}

/** Логический тип внешнего доменного документа, на который ссылается source. */
export type SourceDocumentReferenceTarget
  = | 'action'
    | 'auth-profile'
    | 'component'
    | 'composition'
    | 'computation'
    | 'converter'
    | 'data-view'
    | 'filter'
    | 'i18n-bundles'
    | 'mock'
    | 'query'
    | 'store'
    | 'stream'
    | 'update'
    | 'style'
    | 'type'
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

/** Нейтральное к renderer семантическое выделение одного диапазона Source. */
export interface SourceLanguageSemanticHighlight {
  kind: 'type-reference'
  status: 'resolved' | 'unresolved'
  identity: string
  range: SourceDocumentReference['range']
}

/** Нейтральная к renderer inline-аннотация после одного диапазона Source. */
export interface SourceLanguageInlineHint {
  kind: 'translation'
  status: 'resolved' | 'ambiguous'
  text: string
  tooltip?: string
  range: SourceDocumentReference['range']
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
  /** AST уровня parser. */
  ast?: unknown

  /** Нормализованный source document. */
  document?: unknown

  /** Payload артефакта, готовый для runtime и program. */
  artifact?: any

  /** Публичная metadata, извлечённая из source. */
  metadata?: import('@/modules/program/domain/types/program-metadata.types').ProgramMetadataMap

  /** Diagnostics, найденные source compiler-ом. */
  diagnostics?: unknown[]

  /** Статические зависимости Program, найденные компилятором Source. */
  dependencies?: import('@/modules/program/domain/types/program.types').ProgramDependency[]
}

/** Результат parse source без обязательной runtime-компиляции. */
export interface SourceParseResult<TDocument = unknown> extends SourceEngineResult {
  /** AST уровня parser. */
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
  createDefaultSource: (variant?: string) => string

  /** Нормализует поддержанный syntax, сохраняя остальной авторский source. */
  normalize?: (source: string) => string

  /** Валидирует source без знания о конкретном editor adapter. */
  validate: (source: string, context?: SourceLanguageContext) => SourceLanguageValidationResult

  /** Возвращает доступные подсказки языка в нейтральном формате. */
  completions: (context: SourceLanguageContext) => SourceLanguageCompletion[]

  /** Возвращает сведения о сигнатуре вызова в текущей позиции курсора. */
  signatureHelp?: (context: SourceLanguageContext) => SourceLanguageSignatureHelp | null

  /** Возвращает внешнюю document reference под курсором, если язык её поддерживает. */
  resolveReference?: (context: SourceLanguageContext) => SourceDocumentReference | null

  /** Возвращает semantic highlights без привязки к конкретному editor adapter. */
  semanticHighlights?: (context: SourceLanguageContext) => SourceLanguageSemanticHighlight[]

  /** Возвращает inline annotations без привязки к конкретному editor adapter. */
  inlineHints?: (context: SourceLanguageContext) => SourceLanguageInlineHint[]
}
