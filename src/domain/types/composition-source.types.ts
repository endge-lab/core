import type { ProgramDiagnostic } from '@/domain/types/program.types'
import type { RuntimeHost } from '@/domain/types/runtime-host.types'
import type { SourceFieldDefinition } from '@/domain/types/source-expression.types'

export type CompositionRuntimeKind = 'filter' | 'query' | 'component'

export type CompositionBindingValue
  = | { kind: 'literal', value: unknown }
    | { kind: 'output', runtime: string, output: string }
    | { kind: 'store', key: string }
    | { kind: 'filter-fields', runtime: string, fields: string[] }

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
  instance: string
  persistKey?: string
  props: Record<string, CompositionBindingValue>
}

export type CompositionReaction
  = | { kind: 'mount', target: string }
    | { kind: 'change', runtime: string, output: string, target: string, debounceMs: number }

export interface CompositionOutputDescriptor {
  key: string
  runtime: string
  output?: string
}

export interface CompositionSourceDocument {
  runtimes: CompositionRuntimeDescriptor[]
  reactions: CompositionReaction[]
  outputs: CompositionOutputDescriptor[]
}

/** Payload Composition artifact без runtime state. */
export interface CompositionProgramPayload extends CompositionSourceDocument {
  type: 'composition'
  sourceVersion: number
}

export interface CompositionSourceCompileResult {
  ast: unknown | null
  document: CompositionSourceDocument | null
  artifact: CompositionProgramPayload | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface CompositionRuntimeOutputHandle {
  runtime: RuntimeHost<any, any>
  output?: string
}

export interface CompositionMountOptions {
  id?: string
}
