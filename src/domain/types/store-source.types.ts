import type { ProgramDiagnostic } from '@/domain/types/program.types'

export interface StoreSourceDocument {
  initial: unknown
}

/** Persisted Store artifact v1. Runtime-семантика появится отдельным этапом. */
export interface StoreSourceArtifact extends StoreSourceDocument {
  type: 'store'
  sourceVersion: number
}

export interface StoreSourceCompileResult {
  ast: unknown | null
  document: StoreSourceDocument | null
  artifact: StoreSourceArtifact | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}
