import type {
  DocumentImportDiagnostic,
  DocumentImportFormat,
  DocumentImportSkippedItem,
} from '@/modules/document-import/domain/types/document-import.type'

/** Внутренний черновик Type, который Configurator не может изменить. */
export interface ParsedDocumentImportCandidate {
  id: string
  identity: string
  displayName: string
  description?: string
  source: string
  fields: number
  requiredFields: number
  diagnostics: DocumentImportDiagnostic[]
}

/** Нормализованный результат одного format-specific parser. */
export interface DocumentImportParserResult {
  candidates: ParsedDocumentImportCandidate[]
  diagnostics: DocumentImportDiagnostic[]
  skipped: DocumentImportSkippedItem[]
}

/** Внутренний contract парсера внешнего документного формата. */
export interface DocumentImportParser {
  readonly format: DocumentImportFormat
  parse: (source: string) => DocumentImportParserResult
}
