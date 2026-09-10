import type { SimulationMountOptions, SimulationRuntimeSession } from '@/features/core/modules/runtime/domain/simulation-runtime.types'
import type { SimulationRuntimeHost } from '@/features/core/modules/runtime/hosts/SimulationRuntimeHost'
import { Endge } from '@/features/core/kernel/endge'

/** Запускает Simulation через тот же registry и lifecycle, что Project и Composition. */
export class EndgeSimulation {
  public async mount(identity: string, options: SimulationMountOptions = {}): Promise<SimulationRuntimeSession> {
    const model = Endge.domain.getSimulation(String(identity ?? '').trim())
    if (!model) {
      throw new Error(`[Simulation] Документ "${identity}" отсутствует.`)
    }
    const host = await Endge.runtime.executeAsync(model, {
      artifactReader: options.artifactReader,
      persistence: 'disabled',
      meta: { forceMock: options.forceMock === true, targetProps: options.props ?? {} },
    }) as SimulationRuntimeHost | null
    if (!host) {
      throw new Error(`[Simulation] Документ "${identity}" не может быть запущен.`)
    }
    try {
      await host.activateTarget()
    }
    catch (error) {
      await Endge.runtime.destroyRuntimeTreeAsync(host.id)
      throw error
    }
    let unmounting: Promise<void> | null = null
    return {
      id: host.id,
      host,
      pause: () => host.pause(),
      resume: () => host.resume(),
      unmount: () => unmounting ??= Endge.runtime.destroyRuntimeTreeAsync(host.id),
    }
  }
}
