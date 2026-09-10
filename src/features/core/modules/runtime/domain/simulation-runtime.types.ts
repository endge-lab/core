import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { SimulationRuntimeHost } from '@/features/core/modules/runtime/hosts/SimulationRuntimeHost'

export interface SimulationMountOptions {
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
