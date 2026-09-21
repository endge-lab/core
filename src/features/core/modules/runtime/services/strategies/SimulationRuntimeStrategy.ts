import type { RuntimeStrategy } from '@/features/core/modules/runtime/domain/runtime-strategy.types'
import { RSimulation } from '@/features/core/modules/domain/entities/RSimulation'
import { SimulationRuntimeHost } from '@/features/core/modules/runtime/hosts/SimulationRuntimeHost'

export class SimulationRuntimeStrategy implements RuntimeStrategy<RSimulation, SimulationRuntimeHost> {
  public readonly id = 'runtime:simulation'
  public readonly entityType = 'simulation' as const

  public supports(model: unknown): model is RSimulation {
    return model instanceof RSimulation || (model as { type?: string } | null)?.type === 'simulation'
  }

  public create(context: Parameters<RuntimeStrategy<RSimulation, SimulationRuntimeHost>['create']>[0]) {
    return SimulationRuntimeHost.createRuntime(context)
  }
}
