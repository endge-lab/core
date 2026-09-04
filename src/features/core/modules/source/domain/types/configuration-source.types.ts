import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { TypeSourceExpression } from '@/features/core/modules/source/domain/types/type-source.types'

/** Сохраняемое JSON-сериализуемое значение конфигурации. */
export type EndgeJSONValue
  = | null
    | boolean
    | number
    | string
    | EndgeJSONValue[]
    | { [key: string]: EndgeJSONValue }

/** Одна пользовательская настройка на основе Source. */
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

/** Канонический документ Configuration Source v1. */
export interface ConfigurationSourceDocument {
  values: ConfigurationSourceValueDefinition[]
}

/** Ранний артефакт Configuration для компилятора. */
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
  /** Best-effort проекция AST для визуального исправления, когда семантическая диагностика блокирует компиляцию. */
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
