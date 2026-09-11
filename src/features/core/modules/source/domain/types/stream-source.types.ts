import type { ProgramMetadataMap } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'

export interface StreamSseTransportDescriptor {
  kind: 'sse'
  url: string
  withCredentials: boolean
  authMode: 'inherit' | 'profile' | 'none'
  authProfileIdentity: string | null
}

export type StreamJsonValue = string | number | boolean | null | StreamJsonValue[] | { [key: string]: StreamJsonValue }

export interface StreamWebSocketTransportDescriptor {
  kind: 'websocket'
  url: string
  onOpen: StreamJsonValue[]
}

export type StreamTransportDescriptor = StreamSseTransportDescriptor | StreamWebSocketTransportDescriptor

export interface StreamEventDescriptor {
  sourceEvent: string
  type: string | null
  typePath: string | null
  payloadPath: string | null
  /** Точные значения по dot-path исходного сообщения, проверяемые до eachFrom. */
  match?: Record<string, string | number | boolean | null>
  /** Путь к массиву; typePath и payloadPath читаются относительно каждого элемента. */
  eachFrom?: string
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
  metadata: ProgramMetadataMap
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
