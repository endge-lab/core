import type { CompositionSession } from '@/domain/types/source/composition-source.types'
import type {
  ProjectCompositionHandle,
  ProjectCompositionRegistry,
  ProjectRuntimeMountOptions,
  ProjectRuntimeSession,
} from '@/domain/types/runtime/runtime-project-session.types'

import type { CompositionRuntimeHost } from '@/domain/entities/runtime/hosts/CompositionRuntimeHost'
import type { ProjectRuntimeHost } from '@/domain/entities/runtime/hosts/ProjectRuntimeHost'
import { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import { Endge } from '@/model/endge/kernel/endge'

class ProjectCompositionHandleImpl implements ProjectCompositionHandle {
  public readonly identity: string
  private _host: CompositionRuntimeHost | null = null
  private _disposed = false

  public constructor(
    identity: string,
    private readonly _projectHost: ProjectRuntimeHost,
    private readonly _projectScope: RuntimeScope,
  ) {
    this.identity = identity
  }

  public get state(): 'inactive' | 'active' | 'paused' | 'disposed' {
    if (this._disposed) return 'disposed'
    const scope = this._host?.getScope('scope_default')
    if (!scope) return 'inactive'
    return scope.state === 'paused' ? 'paused' : 'active'
  }

  public get host(): CompositionRuntimeHost | null { return this._host }
  public get outputs() { return this._host?.getOutputs() ?? {} }

  public async activate(): Promise<CompositionSession> {
    if (this._disposed)
      throw new Error(`[EndgeProject] Composition "${this.identity}" handle is disposed.`)
    if (!this._host) {
      const model = Endge.domain.getComposition(this.identity)
      const artifact = Endge.program.getCompositionArtifact(this.identity)
      if (!model || !artifact || artifact.status === 'error')
        throw new Error(`[EndgeProject] Composition "${this.identity}" is unavailable.`)
      const host = Endge.runtime.execute(model, {
        parent: this._projectHost,
        persistence: 'disabled',
        meta: { runtimeScopeId: this._projectScope.id, projectSession: this._projectHost.id },
      }) as CompositionRuntimeHost | null
      if (!host)
        throw new Error(`[EndgeProject] Composition "${this.identity}" cannot be created.`)
      try { await host.mountGraph() }
      catch (error) {
        Endge.runtime.destroyRuntimeTree(host.id)
        throw error
      }
      this._host = host
    }
    const host = this._host
    await host.getScope('scope_default')?.activate()
    return {
      id: host.id,
      host,
      outputs: host.getOutputs(),
      output: <T = unknown>(name: string) => host.getOutput(name) as T | undefined,
      unmount: () => this.deactivate(),
    }
  }

  public async pause(): Promise<void> {
    await this._host?.getScope('scope_default')?.pause()
  }

  public async resume(): Promise<void> {
    await this._host?.getScope('scope_default')?.activate()
  }

  public async restart(): Promise<CompositionSession> {
    await this.deactivate()
    return this.activate()
  }

  public async deactivate(): Promise<void> {
    const host = this._host
    if (!host) return
    await host.getScope('scope_default')?.dispose()
    Endge.runtime.destroyRuntimeTree(host.id)
    this._host = null
  }

  public output<T = unknown>(name: string): T | undefined {
    return this._host?.getOutput(name) as T | undefined
  }

  public async dispose(): Promise<void> {
    await this.deactivate()
    this._disposed = true
  }
}

class ProjectCompositionRegistryImpl implements ProjectCompositionRegistry {
  public constructor(private readonly _handles: Map<string, ProjectCompositionHandleImpl>) {}
  public get(identity: string): ProjectCompositionHandle | null {
    return this._handles.get(String(identity ?? '').trim()) ?? null
  }
  public require(identity: string): ProjectCompositionHandle {
    const handle = this.get(identity)
    if (!handle)
      throw new Error(`[EndgeProject] Project Composition "${identity}" is missing.`)
    return handle
  }
  public getAll(): ProjectCompositionHandle[] { return [...this._handles.values()] }
}

/** Mounts one project into an isolated runtime session. */
export class EndgeProject {
  public async mount(identity: string, options: ProjectRuntimeMountOptions = {}): Promise<ProjectRuntimeSession> {
    const normalized = String(identity ?? '').trim()
    const model = Endge.domain.getProject(normalized)
    if (!model)
      throw new Error(`[EndgeProject] Project "${normalized}" is missing.`)
    const host = Endge.runtime.execute(model, { persistence: 'disabled' }) as ProjectRuntimeHost | null
    if (!host)
      throw new Error(`[EndgeProject] Project "${normalized}" cannot be mounted.`)
    const ownerScope = Endge.runtime.getRuntimeScopeByHost(host.id)
    if (!ownerScope) {
      Endge.runtime.destroyRuntimeTree(host.id)
      throw new Error(`[EndgeProject] Runtime owner scope for "${normalized}" is missing.`)
    }
    const projectScope = Endge.runtime.scopes.register(new RuntimeScope({
      id: `${host.id}:scope:project`,
      path: normalized,
      boundaryId: `${host.id}:scope:project`,
      parent: ownerScope,
      ownerRuntimeId: host.id,
      hooks: { destroyRuntime: runtimeId => Endge.runtime.destroyRuntimeTree(runtimeId) },
    }))
    await projectScope.activate()

    const handles = new Map<string, ProjectCompositionHandleImpl>()
    const compositions = Endge.domain.getCompositions()
      .filter(item => item.kind === 'project' && item.kindIdentity === normalized && item.active !== false && !item.deletedAt)
      .sort((left, right) => left.identity.localeCompare(right.identity))
    for (const composition of compositions)
      handles.set(composition.identity, new ProjectCompositionHandleImpl(composition.identity, host, projectScope))

    try {
      for (const composition of compositions) {
        const artifact = Endge.program.getCompositionArtifact(composition.identity)
        if (!artifact || artifact.status === 'error')
          throw new Error(`[EndgeProject] Project Composition "${composition.identity}" is invalid.`)
        if (options.autoActivate !== 'none' && artifact.payload.activation?.mode === 'startup')
          await handles.get(composition.identity)?.activate()
      }
    }
    catch (error) {
      for (const handle of [...handles.values()].reverse()) await handle.dispose()
      await Endge.runtime.scopes.remove(projectScope.id)
      Endge.runtime.destroyRuntimeTree(host.id)
      throw error
    }

    let mounted = true
    return {
      id: host.id,
      compositions: new ProjectCompositionRegistryImpl(handles),
      switchScope: async ({ from = null, to, previous = 'pause' }) => {
        const target = Endge.runtime.scopes.get(to.id)
        const source = from ? Endge.runtime.scopes.get(from.id) : null
        if (!target || !isDescendantOf(target, projectScope))
          throw new Error('[EndgeProject] Target scope belongs to another or disposed session.')
        if (from && (!source || !isDescendantOf(source, projectScope)))
          throw new Error('[EndgeProject] Source scope belongs to another or disposed session.')
        const targetWasActive = to.state === 'active'
        try {
          await Endge.runtime.scopes.transaction(() => Endge.styles.transaction(async () => {
              await to.activate()
              if (!from || from.id === to.id) return
              if (previous === 'deactivate') await from.deactivate()
              else await from.pause()
            }))
        }
        catch (error) {
          if (!targetWasActive) await to.deactivate().catch(() => {})
          throw error
        }
      },
      unmount: async () => {
        if (!mounted) return
        mounted = false
        for (const handle of [...handles.values()].reverse()) await handle.dispose()
        await Endge.runtime.scopes.remove(projectScope.id)
        Endge.runtime.destroyRuntimeTree(host.id)
      },
    }
  }
}

function isDescendantOf(scope: RuntimeScope, ancestor: RuntimeScope): boolean {
  for (let current: RuntimeScope | null = scope; current; current = current.parent) {
    if (current.id === ancestor.id) return true
  }
  return false
}
