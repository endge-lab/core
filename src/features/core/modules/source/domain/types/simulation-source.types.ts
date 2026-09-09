import type { ProgramDependency, ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'

/** Декларация будущей подмены request. Генерация данных здесь не выполняется. */
export interface SimulationMockRequest {
  kind: 'mock-request'
  seed?: string
  arrays: Record<string, number>
}

export interface SimulationRuntimeOverride {
  alias: string
  runtimes?: SimulationRuntimeOverride[]
  request?: SimulationMockRequest
}

export interface SimulationSourceDocument {
  target: string
  runtimes: SimulationRuntimeOverride[]
}

export interface SimulationSourceArtifact extends SimulationSourceDocument {
  type: 'simulation'
  sourceVersion: number
}

export interface SimulationSourceCompileResult {
  ast: unknown | null
  document: SimulationSourceDocument | null
  artifact: SimulationSourceArtifact | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
  dependencies: ProgramDependency[]
  locations: Record<string, { start: number, end: number }>
}

/** Read-only authoring inputs; Source services не получают Domain owner. */
export interface SimulationSourceInput {
  id: string | number
  identity: string
  displayName?: string
  source: string
  sourceVersion: number
  isPrimitive?: boolean
}

export interface SimulationSourceCatalog {
  compositions: readonly SimulationSourceInput[]
  queries: readonly SimulationSourceInput[]
  types: readonly SimulationSourceInput[]
}
