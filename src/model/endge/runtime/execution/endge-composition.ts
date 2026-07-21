import type { CompositionMountOptions, CompositionSession } from '@/domain/types/source/composition-source.types'

import type { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import { Endge } from '@/model/endge/kernel/endge'

/** Публичный facade монтирования Composition runtime sessions. */
export class EndgeComposition {
  /** Монтирует Composition runtime и возвращает управляемую session. */
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
      persistence: 'disabled',
      meta: options.dataRuntimes || options.props
        ? {
            ...(options.dataRuntimes ? { dataRuntimes: options.dataRuntimes } : {}),
            ...(options.props ? { input: { kind: 'local' as const, props: options.props } } : {}),
          }
        : undefined,
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
      output: <T = unknown>(name: string) => host.getOutput(name) as T | undefined,
      unmount: async () => {
        if (!mounted)
          return
        mounted = false
        await host.getScope('scope_default')?.dispose()
        Endge.runtime.destroyRuntimeTree(host.id)
      },
    }
  }
}
