import type { ProgramDiagnostic } from '@/domain/types/program/program.types'

export type UpdateMutationStrategy = 'set' | 'merge' | 'replace' | 'append' | 'remove'

export interface UpdateSourceDocument {
  handles: string | null
  strategy: UpdateMutationStrategy
  target: string
  keyFrom: string | null
  valueFrom: string | null
}

/** Runtime-ready Update artifact, always scoped to its owner Store. */
export interface UpdateSourceArtifact extends UpdateSourceDocument {
  type: 'update'
  sourceVersion: number
  storeIdentity: string
}

export interface UpdateSourceCompileResult {
  ast: unknown | null
  document: UpdateSourceDocument | null
  artifact: Omit<UpdateSourceArtifact, 'storeIdentity'> | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface StoreMutationPlan {
  strategy: UpdateMutationStrategy
  path: string
  value?: unknown
  vars?: Record<string, unknown>
}
