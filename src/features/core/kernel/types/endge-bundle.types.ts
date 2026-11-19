import type { InspectionRecording } from '@/features/core/modules/inspection/types/inspection.types'
import type { ExecutionBundle } from '@/features/core/modules/program/domain/types/execution-bundle.types'
import type { ModuleManifest } from '@/features/core/modules/runtime/module/module-artifact'

export type DeliveryFacetSelection = Readonly<Record<string, { mode: 'one', identity: string } | { mode: 'all' }>>

export interface DeliveryModule {
  manifest: ModuleManifest
  js: string
  css?: string
}

export interface BundleDelivery {
  variants: ExecutionBundle[]
  modules?: DeliveryModule[]
}

// Один контракт для сборки, записи и продолжения записи; codec не владеет состоянием.
export interface EndgeBundle {
  format: 'endge-bundle'
  version: 1 | 2
  bundle?: ExecutionBundle
  inspection?: InspectionRecording
  delivery?: BundleDelivery
}

export type EndgeBundleFileFormat = 'gzip' | 'json'
export type BundleJsonValue = null | boolean | number | string | BundleJsonValue[] | { [key: string]: BundleJsonValue }
