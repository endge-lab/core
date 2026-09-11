import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'

export type UpdateMutationStrategy = 'set' | 'merge' | 'replace' | 'append' | 'remove'

export interface UpdateMutationDescriptor {
  strategy: UpdateMutationStrategy
  target: string
  plane?: 'data' | 'meta'
  namespace?: string | null
  forEach: string | null
  ifExists: string | null
  valueFrom: string | null
  value?: SourceExpressionIR | null
  when?: SourceExpressionIR | null
  vars: Record<string, string>
}

export interface UpdateSourceDocument {
  handles: string[]
  mutations: UpdateMutationDescriptor[]
}

/** Готовый для runtime артефакт Update, всегда ограниченный своим владельцем Store. */
export interface UpdateSourceArtifact extends UpdateSourceDocument {
  type: 'update'
  sourceVersion: number
  storeIdentity: string
}

export interface UpdateSourceCompileResult {
  ast: unknown | null
  document: UpdateSourceDocument | null
  artifact: Omit<UpdateSourceArtifact, 'storeIdentity'> | null
  metadata: ProgramMetadataMap
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface StoreMutationPlan {
  plane?: 'data' | 'meta'
  strategy: UpdateMutationStrategy
  path: string
  namespace?: string
  value?: unknown
  vars?: Record<string, unknown>
}
