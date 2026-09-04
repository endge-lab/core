import type { ProgramDiagnostic } from '@/modules/program/domain/types/program.types'

export interface StreamSseTransportDescriptor {
  kind: 'sse'
  url: string
  withCredentials: boolean
  authMode: 'inherit' | 'profile' | 'none'
  authProfileIdentity: string | null
}

export type StreamTransportDescriptor = StreamSseTransportDescriptor

export interface StreamEventDescriptor {
  sourceEvent: string
  type: string | null
  typePath: string | null
  payloadPath: string | null
}

export interface StreamSourceDocument {
  transport: StreamTransportDescriptor
  events: StreamEventDescriptor[]
}

/** Готовый для runtime артефакт Stream. */
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
