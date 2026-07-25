import type { ProgramDiagnostic } from '@/domain/types/program/program.types'

export interface StreamSseTransportDescriptor {
  kind: 'sse'
  url: string
  withCredentials: boolean
}

export type StreamTransportDescriptor = StreamSseTransportDescriptor

export interface StreamEventDescriptor {
  sourceEvent: string
  type: string
  payloadPath: string | null
}

export interface StreamSourceDocument {
  transport: StreamTransportDescriptor
  events: StreamEventDescriptor[]
}

/** Runtime-ready Stream artifact. */
export interface StreamSourceArtifact extends StreamSourceDocument {
  type: 'stream'
  sourceVersion: number
}

export interface StreamSourceCompileResult {
  ast: unknown | null
  document: StreamSourceDocument | null
  artifact: StreamSourceArtifact | null
  diagnostics: Omit<ProgramDiagnostic, 'entityRef'>[]
}

export interface StreamEventEnvelope {
  type: string
  payload: unknown
  meta: {
    id: string | null
    source: string
    sourceEvent: string
    occurredAt: string
  }
}
