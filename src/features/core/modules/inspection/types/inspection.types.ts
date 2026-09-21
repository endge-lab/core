import type { BundleJsonValue } from '@/features/core/kernel/types/endge-bundle.types'
import type { EndgeContextSnapshot } from '@/features/core/modules/context/domain/context-persistence.types'
import type { RuntimeInspectionSnapshot } from '@/features/core/modules/runtime/domain/runtime-inspection.types'

export interface InspectionState {
  context: EndgeContextSnapshot & { dataMode?: 'live' | 'mock' }
  runtime: RuntimeInspectionSnapshot
  data: BundleJsonValue | null
  dataAvailable: boolean
}

export type InspectionChange
  = | { op: 'set', path: string[], value: BundleJsonValue }
    | { op: 'remove', path: string[] }

interface InspectionRecordHeader { sequence: number, at: number }

export type InspectionRecord = InspectionRecordHeader & (
  | { kind: 'snapshot', scope: 'inspection', revision: number, reason: 'initial' | 'manual' | 'resync' | 'checkpoint', value: InspectionState }
  | { kind: 'snapshot', scope: 'data', revision: number, reason: 'manual' | 'checkpoint', value: { data: BundleJsonValue | null, render?: BundleJsonValue, dataAvailable: boolean } }
  | { kind: 'delta', baseRevision: number, revision: number, changes: InspectionChange[] }
  | { kind: 'event', name: string, payload: BundleJsonValue }
  | { kind: 'marker', name: 'data-enabled' | 'data-disabled' | 'gap' | 'error' | 'stopped', message: string }
)

export interface InspectionChunk {
  firstSequence: number
  lastSequence: number
  records: InspectionRecord[]
}

export interface InspectionRecording {
  version: 1
  programId: string
  runId: string
  recordingId: string
  chunks: InspectionChunk[]
}

/** Transport consumer leases own independent capture policies and sequence. */
export interface InspectionCapture {
  readonly recording: InspectionRecording
  setIncludeData: (value: boolean) => void
  snapshot: (reason?: 'manual' | 'resync') => void
  stop: () => void
}
