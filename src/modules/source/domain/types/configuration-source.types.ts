import type { ProgramDiagnostic } from '@/modules/program/domain/types/program.types'
import type { TypeSourceExpression } from '@/modules/source/domain/types/type-source.types'

/** JSON-serializable persisted configuration value. */
export type EndgeJSONValue
  = | null
    | boolean
    | number
    | string
    | EndgeJSONValue[]
    | { [key: string]: EndgeJSONValue }

/** One source-backed user setting. */
export interface ConfigurationSourceValueDefinition {
  key: string
  type: TypeSourceExpression
  defaultValue: EndgeJSONValue
  defaultWasInferred: boolean
  label: string
  description?: string
  min?: number
  max?: number
  step?: number
}

/** Canonical Configuration Source v1 document. */
export interface ConfigurationSourceDocument {
  values: ConfigurationSourceValueDefinition[]
}

/** Early/compiler-facing Configuration artifact. */
export interface ConfigurationProgramPayload {
  type: 'configuration'
  identity: string
  displayName: string
  sourceVersion: 1
  values: ConfigurationSourceValueDefinition[]
}

export interface ConfigurationSourceCompileResult {
  ast: unknown | null
  document: ConfigurationSourceDocument | null
  /** Best-effort AST projection for visual repair when semantic diagnostics block compilation. */
  draftDocument?: ConfigurationSourceDocument | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface EndgeConfigurationSchemaEntry {
  id: string | number
  identity: string
  displayName: string
  description?: string | null
  sourceVersion: number
  document: ConfigurationSourceDocument | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
  status: 'valid' | 'warning' | 'error'
}
