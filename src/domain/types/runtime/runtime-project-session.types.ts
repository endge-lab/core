import type { CompositionPublicOutputHandle, CompositionSession } from '@/domain/types/source/composition-source.types'
import type { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import type { RuntimeScopeHandle } from '@/domain/types/runtime/runtime-scope.types'
import type { RuntimeArtifactReader } from '@/domain/types/runtime/runtime-host.types'

export interface ProjectCompositionRegistry {
  get: (identity: string) => ProjectCompositionHandle | null
  require: (identity: string) => ProjectCompositionHandle
  getAll: () => ProjectCompositionHandle[]
}

export interface ProjectCompositionHandle {
  readonly identity: string
  readonly state: 'inactive' | 'active' | 'paused' | 'disposed'
  readonly host: CompositionRuntimeHost | null
  readonly outputs: Readonly<Record<string, CompositionPublicOutputHandle>>
  activate: () => Promise<CompositionSession>
  pause: () => Promise<void>
  resume: () => Promise<void>
  restart: () => Promise<CompositionSession>
  deactivate: () => Promise<void>
  output: <T = unknown>(name: string) => T | undefined
}

export interface ProjectRuntimeMountOptions {
  /** `declared` preserves root activateOn; `none` creates stable handles for an on-demand/debug session. */
  autoActivate?: 'declared' | 'none'
  /** Session-local artifact projection used by Preview without mutating Endge.program. */
  artifactReader?: RuntimeArtifactReader
}

export interface ProjectRuntimeSession {
  readonly id: string
  readonly compositions: ProjectCompositionRegistry
  switchScope: (options: {
    from?: RuntimeScopeHandle | null
    to: RuntimeScopeHandle
    previous?: 'pause' | 'deactivate'
  }) => Promise<void>
  unmount: () => Promise<void>
}
