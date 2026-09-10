import type { RuntimeHost } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { SimulationRuntimeHost } from '@/features/core/modules/runtime/hosts/SimulationRuntimeHost'

/** Находит владельца запуска только по lifecycle ancestry конкретного host. */
export function findSimulationRuntime(host: RuntimeHost<any, any> | null | undefined): SimulationRuntimeHost | null {
  let current = host
  while (current) {
    if (current.entityType === 'simulation') {
      return current as SimulationRuntimeHost
    }
    current = current.parent
  }
  return null
}
