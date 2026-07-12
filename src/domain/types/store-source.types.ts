import type { ProgramDiagnostic } from '@/domain/types/program.types'
import type { DataViewRef } from '@/domain/types/data-view-source.types'

export type StoreDataDescriptor = StoreValueDescriptor | StoreDerivedDescriptor

export interface StoreValueDescriptor {
  key: string
  kind: 'value'
  initial: unknown
}

export interface StoreDerivedDescriptor {
  key: string
  kind: 'derived'
  source: string
  dataViews: DataViewRef[]
}

export interface StoreSourceDocument {
  data: StoreDataDescriptor[]
}

/** Runtime-ready Store source artifact v1. */
export interface StoreSourceArtifact extends StoreSourceDocument {
  type: 'store'
  sourceVersion: number
}

export interface StoreSourceCompileResult {
  ast: unknown | null
  document: StoreSourceDocument | null
  artifact: StoreSourceArtifact | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}
