import type { RuntimeArtifactReader } from '@/domain/types/runtime/runtime-host.types'
import type { RuntimeScopeHandle } from '@/domain/types/runtime/runtime-scope.types'
import type { CompositionPublicOutputHandle, CompositionRuntimeHostHandle, CompositionSession } from '@/domain/types/source/composition-source.types'

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
  /** `declared` preserves root activateOn; `none` creates stable handles for an on-demand/debug session. */
  autoActivate?: 'declared' | 'none'
  /** Session-local artifact projection used by Preview without mutating Endge.program. */
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
