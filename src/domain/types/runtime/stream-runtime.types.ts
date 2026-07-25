import type { StreamSourceArtifact } from '@/domain/types/source/stream-source.types'

export interface StreamTransportMessage {
  sourceEvent: string
  id: string | null
  data: unknown
}

export interface StreamTransportConnection {
  close: () => void
}

/** Browser-neutral port used by StreamRuntimeHost. */
export interface StreamTransportFactory {
  open: (
    artifact: StreamSourceArtifact,
    callbacks: {
      message: (message: StreamTransportMessage) => void
      error: (error: unknown) => void
      open: () => void
    },
  ) => StreamTransportConnection
}
