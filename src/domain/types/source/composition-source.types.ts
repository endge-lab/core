import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { ProgramMetadataMap } from '@/domain/types/program/program-metadata.types'
import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'
import type { RuntimeScopeHandle } from '@/domain/types/runtime/runtime-scope.types'
import type { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import type { SourceExpressionIR, SourceFieldDefinition } from '@/domain/types/source/source-expression.types'
import type { FilterViewControlDefinition } from '@/domain/types/ui/filter-view.type'

export type CompositionRuntimeKind = 'filter' | 'query' | 'component' | 'composition' | 'filter-view'

export type CompositionActivationMode = 'startup' | 'manual'

export interface CompositionActivationDescriptor {
  mode: CompositionActivationMode
}

export interface CompositionResourceDescriptor {
  name: string
  path: string
  scopePath: string
  kind: 'style'
  identity: string
  sourceOrder: number
}

export interface CompositionScopeDescriptor {
  name: string
  /** Публичный path; implicit scope_default имеет path "scope_default". */
  path: string
  parentPath: string | null
  activationOverride: CompositionActivationDescriptor | null
  effectiveActivation: CompositionActivationDescriptor
  resources: string[]
  runtimes: string[]
  children: string[]
  sourceOrder: number
}

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
  /** Полный публичный path runtime внутри Composition. */
  path: string
  /** Internal path owning RuntimeScope. */
  scopePath: string
  kind: CompositionRuntimeKind
  identity: string
  /** Явный override в месте вызова runtime. */
  activationOverride: CompositionActivationDescriptor | null
  /** Compiler-linked activation, которую runtime применяет без интерпретации source. */
  effectiveActivation: CompositionActivationDescriptor
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

export interface CompositionRuntimeOutputDescriptor {
  key: string
  kind: 'runtime'
  runtime: string
  output?: string
}

export interface CompositionScopeOutputDescriptor {
  key: string
  kind: 'scope'
  scope: string
}

export type CompositionOutputDescriptor
  = | CompositionRuntimeOutputDescriptor
    | CompositionScopeOutputDescriptor

export interface CompositionSourceDocument {
  activation: CompositionActivationDescriptor | null
  data: CompositionDataDescriptor[]
  resources: CompositionResourceDescriptor[]
  scopes: CompositionScopeDescriptor[]
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
  kind: 'runtime'
  runtime: RuntimeHost<any, any> | null
  output?: string
}

export interface CompositionRuntimeActivationHandle {
  readonly path: string
  readonly state: 'inactive' | 'active' | 'paused' | 'disposed'
  readonly runtime: RuntimeHost<any, any> | null
  activate: () => Promise<RuntimeHost<any, any>>
  pause: () => Promise<void>
  resume: () => Promise<void>
  deactivate: () => Promise<void>
  dispose: () => Promise<void>
  getOutput: (name: string) => unknown
}

export type CompositionPublicOutputHandle
  = | CompositionRuntimeOutputHandle
    | CompositionRuntimeActivationHandle
    | RuntimeScopeHandle

export interface CompositionMountOptions {
  id?: string
  /** Явные runtime-id Store instances для data aliases. */
  dataRuntimes?: Record<string, string>
}

export interface CompositionSession {
  id: string
  host: CompositionRuntimeHost
  outputs: Readonly<Record<string, CompositionPublicOutputHandle>>
  output: <T = unknown>(name: string) => T | undefined
  unmount: () => Promise<void>
}
