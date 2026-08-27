import type { EndgeMockReference } from '@/domain/types/mock/mock-data.type'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { DataViewRef } from '@/domain/types/source/data-view-source.types'
import type { SourceFieldDefinition } from '@/domain/types/source/source-expression.types'

export type StoreDataDescriptor = StoreValueDescriptor | StoreDerivedDescriptor

export interface StoreValueDescriptor {
  key: string
  kind: 'value'
  initial: StoreValueInitializer
  contract?: SourceFieldDefinition | null
}

export type StoreValueInitializer
  = | { kind: 'literal', value: unknown }
    | EndgeMockReference

export interface StoreDerivedDescriptor {
  key: string
  kind: 'derived'
  source: string
  dataViews: DataViewRef[]
  materializationStrategy?: import('@/domain/types/source/data-view-source.types').DataViewMaterializationStrategy
  contract?: SourceFieldDefinition | null
}

export interface StoreSourceDocument {
  data: StoreDataDescriptor[]
}

/** Скомпилированная таблица маршрутизации событий к дочерним Update. */
export interface StoreUpdateHandlerDescriptor {
  identity: string
  eventTypes: string[]
}

/** Runtime-ready Store source artifact v1. */
export interface StoreSourceArtifact extends StoreSourceDocument {
  type: 'store'
  sourceVersion: number
  updateHandlers: StoreUpdateHandlerDescriptor[]
}

export interface StoreSourceCompileResult {
  ast: unknown | null
  document: StoreSourceDocument | null
  artifact: StoreSourceArtifact | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}
