import type { StreamSourceArtifact } from '@/features/core/modules/source/domain/types/stream-source.types'

export interface StreamTransportMessage {
  sourceEvent: string
  id: string | null
  data: unknown
}

export interface StreamTransportConnection {
  close: () => void
}

/** Нейтральный к браузеру порт, используемый StreamRuntimeHost. */
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
