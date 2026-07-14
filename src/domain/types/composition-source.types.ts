import type { ProgramDiagnostic } from '@/domain/types/program.types'
import type { ProgramMetadataMap } from '@/domain/types/program-metadata.types'
import type { RuntimeHost } from '@/domain/types/runtime-host.types'
import type { SourceExpressionIR, SourceFieldDefinition } from '@/domain/types/source-expression.types'
import type { FilterViewControlDefinition } from '@/domain/types/filter-view.type'

export type CompositionRuntimeKind = 'filter' | 'query' | 'component' | 'composition' | 'filter-view'

export type CompositionBindingValue
  = | { kind: 'literal', value: unknown }
    | { kind: 'output', runtime: string, output: string }
    | { kind: 'store', key: string }
    | { kind: 'data', data: string, path: string }
    | { kind: 'filter-fields', runtime: string, fields: string[] }
    | { kind: 'expression', expression: SourceExpressionIR }

export interface CompositionDataDescriptor {
  name: string
  kind: 'store' | 'vocab'
  identity: string
}

export interface CompositionStorePublication {
  data: string
  fields: Record<string, string>
}

export interface CompositionFilterFieldsSlice {
  kind: 'filter-fields'
  runtimeId: string
  runtimeName: string
  fieldKeys: string[]
  fields: SourceFieldDefinition[]
  values: Record<string, unknown>
}

export interface CompositionRuntimeDescriptor {
  name: string
  kind: CompositionRuntimeKind
  identity: string
  fields?: string[]
  controls?: Record<string, FilterViewControlDefinition>
  componentIdentity?: string
  persistKey?: string
  props: Record<string, CompositionBindingValue>
  storeTo: CompositionStorePublication[]
}

export interface CompositionRuntimeChildHandle {
  name: string
  descriptor: CompositionRuntimeDescriptor
  runtime: RuntimeHost<any, any>
}

export type CompositionHook
  = | { kind: 'mount', target: string }
    | { kind: 'change', runtime: string, output: string, target: string, debounceMs: number }

export interface CompositionOutputDescriptor {
  key: string
  runtime: string
  output?: string
}

export interface CompositionSourceDocument {
  data: CompositionDataDescriptor[]
  runtimes: CompositionRuntimeDescriptor[]
  hooks: CompositionHook[]
  outputs: CompositionOutputDescriptor[]
}

/** Нормализованная связь input runtime-ноды. */
export interface CompositionRuntimeInputConnection {
  targetRuntime: string
  targetProp: string
  source: CompositionBindingValue
}

/** Нормализованный trigger логического update runtime-ноды. */
export interface CompositionRuntimeUpdateConnection {
  id: string
  sourceRuntime: string
  sourceOutput: string
  targetRuntime: string
  updateKind: 'run'
  debounceMs: number
}

/** Публикация output runtime-ноды в Composition data. */
export interface CompositionRuntimePublicationConnection {
  id: string
  sourceRuntime: string
  sourceOutput: string
  targetData: string
  targetPath: string
}

/** Действие, выполняемое после mount всего графа. */
export interface CompositionRuntimeMountConnection {
  targetRuntime: string
  updateKind: 'run'
}

/** Исполняемый граф Composition, построенный компилятором из source document. */
export interface CompositionRuntimeGraph {
  inputs: CompositionRuntimeInputConnection[]
  updates: CompositionRuntimeUpdateConnection[]
  publications: CompositionRuntimePublicationConnection[]
  mounts: CompositionRuntimeMountConnection[]
}

/** Payload Composition artifact без runtime state. */
export interface CompositionProgramPayload extends CompositionSourceDocument {
  type: 'composition'
  sourceVersion: number
  graph: CompositionRuntimeGraph
}

export interface CompositionSourceCompileResult {
  ast: unknown | null
  document: CompositionSourceDocument | null
  artifact: CompositionProgramPayload | null
  metadata: ProgramMetadataMap
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface CompositionRuntimeOutputHandle {
  runtime: RuntimeHost<any, any>
  output?: string
}

export interface CompositionMountOptions {
  id?: string
  /** Явные runtime-id Store instances для data aliases. */
  dataRuntimes?: Record<string, string>
}
