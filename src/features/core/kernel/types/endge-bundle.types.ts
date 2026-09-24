import type { InspectionRecording } from '@/features/core/modules/inspection/types/inspection.types'
import type { ExecutionBundle } from '@/features/core/modules/program/domain/types/execution-bundle.types'

// Один контракт для сборки, записи и продолжения записи; codec не владеет состоянием.
export interface EndgeBundle {
  format: 'endge-bundle'
  version: 1
  bundle?: ExecutionBundle
  inspection?: InspectionRecording
}

export type EndgeBundleFileFormat = 'gzip' | 'json'
export type BundleJsonValue = null | boolean | number | string | BundleJsonValue[] | { [key: string]: BundleJsonValue }
