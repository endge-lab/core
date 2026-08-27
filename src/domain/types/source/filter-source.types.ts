import type { ProgramMetadataMap } from '@/domain/types/program/program-metadata.types'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { SourceExpressionIR, SourceFieldDefinition } from '@/domain/types/source/source-expression.types'

/** Source-описание Filter v1. */
export interface FilterSourceDocument {
  fields: SourceFieldDefinition[]
  outputs: FilterProgramOutput[]
}

/** Абсолютный диапазон узла внутри Filter source. */
export interface FilterSourceRange {
  start: number
  end: number
}

/** Source-backed поле для визуального редактора Filter. */
export interface FilterSourceEditorField extends SourceFieldDefinition {
  sourceRange: FilterSourceRange
  keyRange: FilterSourceRange
  valueRange: FilterSourceRange
  valueSource: string
  defaultSource: string | null
}

/** Source-backed output для навигации из визуального редактора. */
export interface FilterSourceEditorOutput {
  key: string
  kind: FilterProgramOutput['kind']
  sourceRange: FilterSourceRange
  source: string
}

/** Проекция Filter source, которая не хранится отдельно от source. */
export interface FilterSourceEditorDocument {
  fields: FilterSourceEditorField[]
  outputs: FilterSourceEditorOutput[]
}

/** Узкие операции визуального редактора над canonical Filter source. */
export type FilterSourcePatchOperation
  = | { type: 'add-field', key: string, expression: string }
    | { type: 'remove-field', key: string }
    | { type: 'move-field', key: string, toIndex: number }
    | { type: 'rename-field', key: string, nextKey: string }
    | { type: 'set-field', key: string, expression: string }

export type FilterSourcePatch
  = FilterSourcePatchOperation
    | FilterSourcePatchOperation[]

/** JSON-output фильтра. */
export interface FilterProgramJsonOutput {
  key: string
  kind: 'json'
  expression: SourceExpressionIR
  dependencies?: string[]
}

/** Локальный predicate, вычисляемый над строкой и state фильтра. */
export interface FilterProgramPredicateOutput {
  key: string
  kind: 'predicate'
  expression: SourceExpressionIR
  dependencies?: string[]
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

export type FilterRuntimeActionId = 'patch' | 'set' | 'reset' | 'clear'

export interface FilterRuntimeSetPayload {
  key: string
  value: unknown
}

export interface FilterRuntimeActionHandle {
  run: (payload?: unknown) => Promise<void>
}
