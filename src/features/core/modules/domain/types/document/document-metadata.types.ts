import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'

export type DocumentMetadataBacking = 'definition-property' | 'definition-declaration' | 'entity-meta'

export interface DocumentMetadataInput {
  source?: string | null
  meta?: Record<string, unknown> | null
}

export interface DocumentMetadataDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  sourcePath?: string
  start?: number
  end?: number
}

/** Единая read-модель пользовательских metadata документа независимо от backing. */
export interface DocumentMetadataProjection {
  backing: DocumentMetadataBacking | null
  mode: 'missing' | 'static' | 'invalid' | 'duplicate'
  editable: boolean
  metadata: ProgramMetadataMap
  json: string
  sourceRange: { start: number, end: number } | null
  diagnostics: DocumentMetadataDiagnostic[]
  message?: string
}

/** Результат узкого metadata patch с сохранением второго backing без изменений. */
export interface DocumentMetadataPatchResult {
  ok: boolean
  source: string
  meta: Record<string, unknown>
  changed: boolean
  projection: DocumentMetadataProjection
  diagnostics: DocumentMetadataDiagnostic[]
  message?: string
}
