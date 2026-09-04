import type { RuntimeArtifactReader } from '@/modules/runtime/domain/runtime-host.types'
import type { RuntimeScopeHandle } from '@/modules/runtime/domain/runtime-scope.types'
import type { CompositionPublicOutputHandle, CompositionRuntimeHostHandle, CompositionSession } from '@/modules/source/domain/types/composition-source.types'

export interface ProjectCompositionRegistry<THost extends CompositionRuntimeHostHandle = CompositionRuntimeHostHandle> {
  get: (identity: string) => ProjectCompositionHandle<THost> | null
  require: (identity: string) => ProjectCompositionHandle<THost>
  getAll: () => ProjectCompositionHandle<THost>[]
}

export interface ProjectCompositionHandle<THost extends CompositionRuntimeHostHandle = CompositionRuntimeHostHandle> {
  readonly identity: string
  readonly state: 'inactive' | 'active' | 'paused' | 'disposed'
  readonly host: THost | null
  readonly outputs: Readonly<Record<string, CompositionPublicOutputHandle>>
  activate: () => Promise<CompositionSession<THost>>
  pause: () => Promise<void>
  resume: () => Promise<void>
  restart: () => Promise<CompositionSession<THost>>
  deactivate: () => Promise<void>
  output: <T = unknown>(name: string) => T | undefined
}

export interface ProjectRuntimeMountOptions {
  /** `declared` сохраняет корневой activateOn; `none` создаёт стабильные handles для сессии по требованию или отладки. */
  autoActivate?: 'declared' | 'none'
  /** Локальная для сессии проекция артефактов, используемая Preview без изменения Endge.program. */
  artifactReader?: RuntimeArtifactReader
}

export interface ProjectRuntimeSession<THost extends CompositionRuntimeHostHandle = CompositionRuntimeHostHandle> {
  readonly id: string
  readonly compositions: ProjectCompositionRegistry<THost>
  switchScope: (options: {
    from?: RuntimeScopeHandle | null
    to: RuntimeScopeHandle
    previous?: 'pause' | 'deactivate'
  }) => Promise<void>
  unmount: () => Promise<void>
}
