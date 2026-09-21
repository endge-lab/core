import type { CompositionRuntimeHost } from '@/features/core/modules/runtime/hosts/CompositionRuntimeHost'
import type { CompositionMountOptions, CompositionPreviewProps, CompositionSession } from '@/features/core/modules/source/domain/types/composition-source.types'

import type { EndgeDataMode } from '@/features/core/modules/workspace/domain/workspace.types'
import { Endge } from '@/features/core/kernel/endge'

/** Публичный API монтирования Composition runtime sessions. */
export class EndgeComposition {
  /** Монтирует Composition runtime и возвращает управляемую session. */
  public async mount(identity: string, options: CompositionMountOptions = {}): Promise<CompositionSession<CompositionRuntimeHost>> {
    const normalizedIdentity = String(identity ?? '').trim()
    const model = Endge.domain.getComposition(normalizedIdentity)
    if (!model) {
      throw new Error(`[EndgeComposition] Composition "${normalizedIdentity}" is missing.`)
    }

    const artifact = Endge.program.getCompositionArtifact(normalizedIdentity)
    if (!artifact) {
      throw new Error(`[EndgeComposition] Compile domain before mounting "${normalizedIdentity}".`)
    }
    if (artifact.status === 'error') {
      throw new Error(`[EndgeComposition] Composition "${normalizedIdentity}" has compile errors.`)
    }

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
    if (!host) {
      throw new Error(`[EndgeComposition] Runtime host cannot be created for "${normalizedIdentity}".`)
    }

    try {
      await host.mountGraph()
    }
    catch (error) {
      await Endge.runtime.destroyRuntimeTreeAsync(host.id)
      throw error
    }

    let mounted = true
    return {
      id: host.id,
      host,
      outputs: host.getOutputs(),
      output: <T = unknown>(name: string) => host.getOutput(name) as T | undefined,
      unmount: async () => {
        if (!mounted) {
          return
        }
        mounted = false
        await host.getScope('scope_default')?.dispose()
        await Endge.runtime.destroyRuntimeTreeAsync(host.id)
      },
    }
  }
}

/** Материализует литералы только для preview и ссылки RMock в обычные props Composition. */
export function materializeCompositionPreviewProps(
  previewProps: CompositionPreviewProps | null | undefined,
  dataMode: EndgeDataMode = Endge.context.dataMode,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(previewProps ?? {}).flatMap(([key, value]) => {
      if (value.kind === 'mock') {
        return dataMode === 'mock'
          ? [[key, Endge.mock.get(value.identity)] as const]
          : []
      }
      return [[key, clonePreviewValue(value.value)] as const]
    }),
  )
}

function clonePreviewValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
