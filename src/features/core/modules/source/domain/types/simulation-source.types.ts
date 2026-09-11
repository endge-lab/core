import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { ProgramDependency, ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'

/** Декларация подмены response Query. Генерация выполняется при запуске Simulation. */
export interface SimulationMockRequest {
  kind: 'mock-request'
  seed?: string
  /** false исключает примеры Type из схемы; ограничения и enum сохраняются. */
  useExamples?: boolean
  arrays: Record<string, number>
}

/** Ограничения сценария сужают существующий Type, не создавая новый Domain Type. */
export interface SimulationFieldConstraints {
  enum?: Array<string | number | boolean>
  minimum?: number
  maximum?: number
}

export interface SimulationMockStream {
  kind: 'mock-stream'
  type: string
  event: string
  seed?: string
  intervalMs: number
  itemsPerMessage: number
  fields: Record<string, SimulationFieldConstraints>
}

export interface SimulationRuntimeOverride {
  alias: string
  runtimes?: SimulationRuntimeOverride[]
  request?: SimulationMockRequest
  stream?: SimulationMockStream
}

export type SimulationTargetReference
  = | { entityType: 'composition', identity: string }
    | { entityType: 'project', identity: string }

export interface SimulationSourceDocument {
  target: SimulationTargetReference
  /** Режим неподменённых источников. Отсутствие значения сохраняет наследование. */
  dataMode?: 'live' | 'mock'
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
  metadata: ProgramMetadataMap
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
  projects: readonly SimulationSourceInput[]
  compositions: readonly SimulationSourceInput[]
  queries: readonly SimulationSourceInput[]
  types: readonly SimulationSourceInput[]
}
