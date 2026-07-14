import type { CompositionMountOptions, CompositionRuntimeOutputHandle } from '@/domain/types/composition-source.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import { Endge } from '@/model/endge/endge'

export interface CompositionSession {
  id: string
  host: CompositionRuntimeHost
  outputs: Readonly<Record<string, CompositionRuntimeOutputHandle>>
  unmount: () => void
}

/** Public mount facade для Composition runtime sessions. */
export class EndgeComposition extends EndgeModule {
  public async mount(identity: string, options: CompositionMountOptions = {}): Promise<CompositionSession> {
    const normalizedIdentity = String(identity ?? '').trim()
    const model = Endge.domain.getComposition(normalizedIdentity)
    if (!model)
      throw new Error(`[EndgeComposition] Composition "${normalizedIdentity}" is missing.`)

    const artifact = Endge.program.getCompositionArtifact(normalizedIdentity)
    if (!artifact)
      throw new Error(`[EndgeComposition] Compile domain before mounting "${normalizedIdentity}".`)
    if (artifact.status === 'error')
      throw new Error(`[EndgeComposition] Composition "${normalizedIdentity}" has compile errors.`)

    const host = Endge.runtime.execute(model, {
      ...(options.id ? { id: options.id } : {}),
      ...(options.dataRuntimes ? { dataRuntimes: options.dataRuntimes } : {}),
      persistence: 'disabled',
    }) as CompositionRuntimeHost | null
    if (!host)
      throw new Error(`[EndgeComposition] Runtime host cannot be created for "${normalizedIdentity}".`)

    try {
      await host.mountGraph()
    }
    catch (error) {
      Endge.runtime.destroyRuntimeTree(host.id)
      throw error
    }

    let mounted = true
    return {
      id: host.id,
      host,
      outputs: host.getOutputs(),
      unmount: () => {
        if (!mounted)
          return
        mounted = false
        Endge.runtime.destroyRuntimeTree(host.id)
      },
    }
  }
}
