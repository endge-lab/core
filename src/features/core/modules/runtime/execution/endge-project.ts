import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type {
  ProjectCompositionHandle,
  ProjectRuntimeMountOptions,
  ProjectRuntimeSession,
} from '@/features/core/modules/runtime/domain/runtime-project-session.types'

import type { ProjectRuntimeHost } from '@/features/core/modules/runtime/hosts/ProjectRuntimeHost'
import type { CompositionProgramPayload, CompositionSession } from '@/features/core/modules/source/domain/types/composition-source.types'
import { Endge } from '@/features/core/kernel/endge'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'

class ProjectCompositionHandleImpl implements ProjectCompositionHandle<ProjectRuntimeHost> {
  public readonly identity: string
  private _host: ProjectRuntimeHost | null = null
  private _disposed = false
  private _generation = 0
  private _pendingHost: ProjectRuntimeHost | null = null
  private _activation: Promise<CompositionSession<ProjectRuntimeHost>> | null = null
  private _transition: Promise<unknown> = Promise.resolve()

  public constructor(
    identity: string,
    private readonly _projectHost: ProjectRuntimeHost,
    private readonly _projectScope: RuntimeScope,
    private readonly _artifactReader: RuntimeArtifactReader,
  ) {
    this.identity = identity
    this._host = _projectHost
  }

  public get state(): 'inactive' | 'active' | 'paused' | 'disposed' {
    if (this._disposed) {
      return 'disposed'
    }
    const scope = this._host?.getScope('scope_default')
    if (!scope) {
      return 'inactive'
    }
    return scope.state === 'paused' ? 'paused' : 'active'
  }

  public get host(): ProjectRuntimeHost | null { return this._host }
  public get outputs() { return this._host?.getOutputs() ?? {} }

  public activate(): Promise<CompositionSession<ProjectRuntimeHost>> {
    if (this._disposed) {
      return Promise.reject(new Error(`[EndgeProject] Composition "${this.identity}" handle is disposed.`))
    }
    if (this._activation) {
      return this._activation
    }
    const generation = this._generation
    const activation = this._enqueue(async () => {
      this._assertCurrent(generation)
      let host = this._host
      if (!host) {
        const model = Endge.domain.getProject(this.identity)
        const artifact = this._artifactReader.getArtifact<CompositionProgramPayload>('project', this.identity)
        if (!model || !artifact || artifact.status === 'error') {
          throw new Error(`[EndgeProject] Composition "${this.identity}" is unavailable.`)
        }
        host = Endge.runtime.execute(model, {
          artifactReader: this._artifactReader,
          persistence: 'disabled',
          meta: { runtimeScopeId: this._projectScope.id, projectSession: this._projectHost.id },
        }) as ProjectRuntimeHost | null
        if (!host) {
          throw new Error(`[EndgeProject] Composition "${this.identity}" cannot be created.`)
        }
      }
      this._pendingHost = host
      try {
        await host.mountGraph()
        this._assertCurrent(generation)
        await host.getScope('scope_default')?.activate()
        this._assertCurrent(generation)
        this._host = host
        return {
          id: host.id,
          host,
          outputs: host.getOutputs(),
          output: <T = unknown>(name: string) => host.getOutput(name) as T | undefined,
          unmount: () => this.deactivate(),
        }
      }
      catch (error) {
        await Endge.runtime.destroyRuntimeTreeAsync(host.id)
        if (this._host === host) {
          this._host = null
        }
        throw error
      }
      finally {
        this._pendingHost = null
      }
    })
    this._activation = activation
    const clear = () => {
      if (this._activation === activation) {
        this._activation = null
      }
    }
    void activation.then(clear, clear)
    return activation
  }

  private _assertCurrent(generation: number): void {
    if (this._disposed || this._generation !== generation) {
      throw new DOMException(`[EndgeProject] Composition "${this.identity}" activation was cancelled.`, 'AbortError')
    }
  }

  private _enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this._transition.then(task, task)
    this._transition = result.then(() => undefined, () => undefined)
    return result
  }

  public async pause(): Promise<void> {
    await this._enqueue(async () => {
      await this._host?.getScope('scope_default')?.pause()
    })
  }

  public async resume(): Promise<void> {
    await this._enqueue(async () => {
      await this._host?.getScope('scope_default')?.activate()
    })
  }

  public async restart(): Promise<CompositionSession<ProjectRuntimeHost>> {
    await this.deactivate()
    return this.activate()
  }

  public deactivate(): Promise<void> {
    this._generation += 1
    this._activation = null
    // Abort acquisition immediately; waiting for the transition first would deadlock on it.
    this._pendingHost?.quiesce()
    const stopping = (this._pendingHost ?? this._host)?.getScope('scope_default')?.deactivate()
    void stopping?.catch(() => {})
    return this._enqueue(async () => {
      try {
        await stopping
      }
      finally {
        const host = this._host
        this._host = null
        if (host) {
          await Endge.runtime.destroyRuntimeTreeAsync(host.id)
        }
      }
    })
  }

  public output<T = unknown>(name: string): T | undefined {
    return this._host?.getOutput(name) as T | undefined
  }

  public async dispose(): Promise<void> {
    this._disposed = true
    await this.deactivate()
  }
}

/** Монтирует один project в изолированную runtime-сессию. */
export class EndgeProject {
  public async mount(identity: string, options: ProjectRuntimeMountOptions = {}): Promise<ProjectRuntimeSession<ProjectRuntimeHost>> {
    const normalized = String(identity ?? '').trim()
    const model = Endge.domain.getProject(normalized)
    if (!model) {
      throw new Error(`[EndgeProject] Project "${normalized}" is missing.`)
    }
    const artifactReader = options.artifactReader ?? Endge.program
    const host = Endge.runtime.execute(model, {
      artifactReader,
      persistence: 'disabled',
    }) as ProjectRuntimeHost | null
    if (!host) {
      throw new Error(`[EndgeProject] Project "${normalized}" cannot be mounted.`)
    }
    const ownerScope = Endge.runtime.getRuntimeScopeByHost(host.id)
    if (!ownerScope) {
      await Endge.runtime.destroyRuntimeTreeAsync(host.id)
      throw new Error(`[EndgeProject] Runtime owner scope for "${normalized}" is missing.`)
    }
    const projectScope = Endge.runtime.scopes.register(new RuntimeScope({
      id: `${host.id}:scope:project`,
      path: normalized,
      boundaryId: `${host.id}:scope:project`,
      parent: ownerScope,
      ownerRuntimeId: host.id,
      hooks: { destroyRuntime: runtimeId => Endge.runtime.destroyRuntimeTreeAsync(runtimeId) },
    }))
    await projectScope.activate()

    Endge.runtime.scopes.detachRuntime(host.id)
    host.meta.runtimeScopeId = projectScope.id
    host.meta.projectSession = host.id
    Endge.runtime.scopes.attachRuntime(projectScope.id, host)
    const composition = new ProjectCompositionHandleImpl(normalized, host, projectScope, artifactReader)
    try {
      const artifact = artifactReader.getArtifact<CompositionProgramPayload>('project', normalized)
      if (!artifact || artifact.status === 'error') {
        throw new Error(`[EndgeProject] Project "${normalized}" artifact is invalid.`)
      }
      if (options.autoActivate !== 'none' && artifact.payload.activation?.mode === 'startup') {
        await composition.activate()
      }
    }
    catch (error) {
      try {
        await composition.dispose()
      }
      finally {
        await Endge.runtime.scopes.remove(projectScope.id)
      }
      throw error
    }

    let unmounting: Promise<void> | null = null
    return {
      id: host.id,
      composition,
      switchScope: async ({ from = null, to, previous = 'pause' }) => {
        const target = Endge.runtime.scopes.get(to.id)
        const source = from ? Endge.runtime.scopes.get(from.id) : null
        if (!target || !isDescendantOf(target, projectScope)) {
          throw new Error('[EndgeProject] Target scope belongs to another or disposed session.')
        }
        if (from && (!source || !isDescendantOf(source, projectScope))) {
          throw new Error('[EndgeProject] Source scope belongs to another or disposed session.')
        }
        const targetWasActive = to.state === 'active'
        try {
          await Endge.runtime.scopes.transaction(() => Endge.styles.transaction(async () => {
            await to.activate()
            if (!from || from.id === to.id) {
              return
            }
            if (previous === 'deactivate') {
              await from.deactivate()
            }
            else { await from.pause() }
          }))
        }
        catch (error) {
          if (!targetWasActive) {
            await to.deactivate().catch(() => {})
          }
          throw error
        }
      },
      unmount: () => {
        unmounting ??= (async () => {
          try {
            await composition.dispose()
          }
          finally {
            await Endge.runtime.scopes.remove(projectScope.id)
          }
        })()
        return unmounting
      },
    }
  }
}

function isDescendantOf(scope: RuntimeScope, ancestor: RuntimeScope): boolean {
  for (let current: RuntimeScope | null = scope; current; current = current.parent) {
    if (current.id === ancestor.id) {
      return true
    }
  }
  return false
}
