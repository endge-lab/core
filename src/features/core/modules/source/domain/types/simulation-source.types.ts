import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { ProgramDependency, ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'

// Декларация подмены response Query. Генерация выполняется при запуске Simulation.
export interface SimulationMockRequest {
  kind: 'mock-request'
  seed?: string
  // false исключает примеры Type из схемы; ограничения и enum сохраняются.
  useExamples?: boolean
  arrays: Record<string, number>
  // Только GraphQL Query: errors сгенерированного ответа; обрабатываются по errorPolicy Query.
  errors?: SimulationGraphQLError[]
}

// Ограничения сценария сужают существующий Type, не создавая новый Domain Type.
export interface SimulationFieldConstraints {
  enum?: Array<string | number | boolean>
  minimum?: number
  maximum?: number
}

export interface SimulationMockStream {
  kind: 'mock-stream'
  // Для graphqlSse — Type объекта data события next; для sse/websocket — business payload.
  type: string
  // Нормализованный тип события для sse/websocket. Для graphqlSse пуст: тип задаёт events.next Stream.
  event: string
  seed?: string
  intervalMs: number
  itemsPerMessage: number
  fields: Record<string, SimulationFieldConstraints>
  // Только graphqlSse: errors каждого события next; обрабатываются по errorPolicy Stream.
  errors?: SimulationGraphQLError[]
}

// GraphQL error события next в форме ответа сервера.
export interface SimulationGraphQLError {
  message: string
  path?: Array<string | number>
  [key: string]: unknown
}

export interface SimulationRuntimeOverride {
  alias: string
  runtimes?: SimulationRuntimeOverride[]
  request?: SimulationMockRequest
  stream?: SimulationMockStream
}

export interface SimulationTargetReference {
  entityType: 'composition'
  identity: string
}

export interface SimulationSourceDocument {
  target: SimulationTargetReference
  // Режим неподменённых источников. Отсутствие значения сохраняет наследование.
  dataMode?: 'live' | 'mock'
  runtimes: SimulationRuntimeOverride[]
}

export interface SimulationSourceArtifact extends SimulationSourceDocument {
  // Optional parser tree retained for inspection; runtime does not require it.
  ast?: unknown
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

// Read-only authoring inputs; Source services не получают Domain owner.
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
  // Stream Sources для проверки mockStream по виду transport; без каталога transport считается sse/websocket.
  streams?: readonly SimulationSourceInput[]
}
