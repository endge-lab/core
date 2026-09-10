import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { StreamTransportConnection, StreamTransportFactory } from '@/features/core/modules/runtime/domain/stream-runtime.types'
import type { SimulationRuntimeHost } from '@/features/core/modules/runtime/hosts/SimulationRuntimeHost'
import type { SimulationMockStream } from '@/features/core/modules/source/domain/types/simulation-source.types'

/** Host adapter выполняет только transport; schema compilation/PRNG принадлежат сервису. */
export interface SimulationGenerator {
  generate: (schema: Record<string, unknown>, seed: string, signal: AbortSignal) => Promise<unknown>
  openStream: (
    schema: Record<string, unknown>,
    options: SimulationMockStream,
    callbacks: Parameters<StreamTransportFactory['open']>[1],
  ) => StreamTransportConnection
}

export interface SimulationMountOptions {
  generator?: SimulationGenerator
  /** Preview может передать draft artifact без изменения общей Program. */
  artifactReader?: RuntimeArtifactReader
  /** Принудительный МОК поверхности запуска имеет приоритет над Simulation dataMode. */
  forceMock?: boolean
  /** Явные входы target; Core не подставляет preview fixtures самостоятельно. */
  props?: Record<string, unknown>
}

export interface SimulationRuntimeSession {
  readonly id: string
  readonly host: SimulationRuntimeHost
  pause: () => Promise<void>
  resume: () => Promise<void>
  unmount: () => Promise<void>
}
