/** Внешние форматы, из которых Core умеет подготовить Domain-документы. */
export type DocumentImportFormat = 'graphql' | 'openapi'

/** Состояние кандидата относительно текущего Domain. */
export type DocumentImportCandidateStatus = 'ready' | 'conflict' | 'invalid'

/** Нормализованная диагностика импорта без привязки к конкретному UI. */
export interface DocumentImportDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  candidateId?: string
  line?: number
  column?: number
}

/** Неподдержанная конструкция исходного документа. */
export interface DocumentImportSkippedItem {
  kind: string
  identity?: string
  reason: string
}

/** Renderer-neutral описание одного документа, доступного для выбора. */
export interface DocumentImportCandidate {
  id: string
  documentType: 'type'
  identity: string
  displayName: string
  description?: string
  status: DocumentImportCandidateStatus
  sourcePreview: string
  summary: {
    fields: number
    requiredFields: number
  }
  diagnostics: DocumentImportDiagnostic[]
}

/** Публичное представление подготовленного, но ещё не применённого импорта. */
export interface DocumentImportPlan {
  id: string
  format: DocumentImportFormat
  sourceName?: string
  createdAt: string
  candidates: DocumentImportCandidate[]
  diagnostics: DocumentImportDiagnostic[]
  skipped: DocumentImportSkippedItem[]
}

/** Вход подготовки import plan. Source передаётся как обычный текст. */
export interface DocumentImportPrepareRequest {
  format: DocumentImportFormat
  source: string
  sourceName?: string
}

/** Папка назначения для создаваемых документов. */
export interface DocumentImportDestination {
  folderId: string | number | null
}

/** Подтверждённый пользователем набор кандидатов. */
export interface DocumentImportApplyRequest {
  planId: string
  selectedCandidateIds: readonly string[]
  destination: DocumentImportDestination
  conflictPolicy?: 'skip'
}

/** Результат применения одного кандидата. */
export interface DocumentImportApplyItemResult {
  candidateId: string
  identity: string
  status: 'imported' | 'skipped' | 'failed'
  message?: string
}

/** Результат одной подтверждённой операции импорта. */
export interface DocumentImportApplyResult {
  planId: string
  imported: number
  skipped: number
  failed: number
  items: DocumentImportApplyItemResult[]
}
