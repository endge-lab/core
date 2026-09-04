import type { EndgeMockReference } from '@/features/core/modules/mock/domain/types/mock-data.type'
import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { DataViewRef } from '@/features/core/modules/source/domain/types/data-view-source.types'
import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'

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
  materializationStrategy?: import('@/features/core/modules/source/domain/types/data-view-source.types').DataViewMaterializationStrategy
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

/** Готовый для runtime артефакт source Store v1. */
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
