import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { ProgramMetadataMap } from '@/domain/types/program/program-metadata.types'
import type { SourceExpressionIR, SourceFieldDefinition } from '@/domain/types/source/source-expression.types'

/** Source-описание Filter v1. */
export interface FilterSourceDocument {
  fields: SourceFieldDefinition[]
  outputs: FilterProgramOutput[]
}

/** JSON-output фильтра. */
export interface FilterProgramJsonOutput {
  key: string
  kind: 'json'
  expression: SourceExpressionIR
}

/** Локальный predicate, вычисляемый над строкой и state фильтра. */
export interface FilterProgramPredicateOutput {
  key: string
  kind: 'predicate'
  expression: SourceExpressionIR
}

export type FilterProgramOutput
  = | FilterProgramJsonOutput
    | FilterProgramPredicateOutput

/** Payload Filter artifact без persisted source и diagnostics envelope. */
export interface FilterProgramPayload {
  type: 'filter'
  sourceVersion: number
  fields: SourceFieldDefinition[]
  defaults: Record<string, SourceExpressionIR | undefined>
  outputs: FilterProgramOutput[]
}

/** Результат компиляции Filter source. */
export interface FilterSourceCompileResult {
  ast: unknown | null
  document: FilterSourceDocument | null
  artifact: FilterProgramPayload | null
  metadata: ProgramMetadataMap
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

/** Runtime-value одного Filter output. */
export type FilterRuntimeOutput
  = | { key: string, kind: 'json', value: unknown }
    | { key: string, kind: 'predicate', test: (row: unknown) => boolean }

export type FilterRuntimeCommandId = 'patch' | 'set' | 'reset' | 'clear'

export interface FilterRuntimeSetPayload {
  key: string
  value: unknown
}

export interface FilterRuntimeCommandHandle {
  run: (payload?: unknown) => Promise<void>
}
