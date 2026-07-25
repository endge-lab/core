import type { ProgramDiagnostic } from '@/domain/types/program/program.types'

export type UpdateMutationStrategy = 'set' | 'merge' | 'replace' | 'append' | 'remove'

export interface UpdateMutationDescriptor {
  strategy: UpdateMutationStrategy
  target: string
  forEach: string | null
  ifExists: string | null
  valueFrom: string | null
  vars: Record<string, string>
}

export interface UpdateSourceDocument {
  handles: string[]
  mutations: UpdateMutationDescriptor[]
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
