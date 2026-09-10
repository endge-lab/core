import type { RSimulation } from '@/features/core/modules/domain/entities/RSimulation'
import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContextBase } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { SimulationGenerator } from '@/features/core/modules/runtime/domain/simulation-runtime.types'
import type { StreamTransportFactory } from '@/features/core/modules/runtime/domain/stream-runtime.types'
import type { CompositionRuntimeHost } from '@/features/core/modules/runtime/hosts/CompositionRuntimeHost'
import type { SimulationOverrides } from '@/features/core/modules/runtime/services/simulation/prepare-simulation-overrides'
import type { SimulationSourceArtifact } from '@/features/core/modules/source/domain/types/simulation-source.types'

import { Raph, RaphNode } from '@endge/raph'
import { Endge } from '@/features/core/kernel/endge'
import { RuntimeHostBase } from '@/features/core/modules/runtime/RuntimeHostBase'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { prepareSimulationOverrides } from '@/features/core/modules/runtime/services/simulation/prepare-simulation-overrides'

/** Владелец одного изолированного запуска target через общий runtime registry. */
export class SimulationRuntimeHost extends RuntimeHostBase<'simulation', RuntimeHostContextBase, SimulationSourceArtifact> {
  public readonly forceMock: boolean
  private _target: CompositionRuntimeHost<'composition' | 'project'> | null = null
  private _scope: RuntimeScope | null = null
  private _responses: ReadonlyMap<string, unknown> = new Map()
  private readonly _overrides: SimulationOverrides
  private readonly _generator: SimulationGenerator | undefined
  private _abortController = new AbortController()
  private _generation = 0
  private _closed = false
  private _transition: Promise<unknown> = Promise.resolve()
  private _activation: Promise<CompositionRuntimeHost<'composition' | 'project'>> | null = null
  private _destroying: Promise<void> | null = null

  private constructor(input: {
    id: string
    model: RSimulation
    parent: RuntimeHost<any, any> | null
    meta: Record<string, unknown>
    artifacts: RuntimeArtifactReader
    overrides: SimulationOverrides
  }) {
    super({
      ...input,
      kind: 'simulation',
      runtimeType: 'simulation-runtime-host',
      entityType: 'simulation',
      entityIdentity: input.model.identity,
      title: input.model.displayName ?? input.model.name ?? input.model.identity,
      artifactReader: input.artifacts,
      artifactRef: { entityType: 'simulation', id: input.model.id, identity: input.model.identity },
      context: { status: 'idle', startedAt: null, updatedAt: null },
    })
    this.forceMock = input.meta.forceMock === true
    this._overrides = input.overrides
    this._generator = input.meta.simulationGenerator as SimulationGenerator | undefined
  }

  public static createRuntime(input: {
    id: string
    model: RSimulation
    parent: RuntimeHost<any, any> | null
    meta: Record<string, unknown>
    artifacts: RuntimeArtifactReader
  }): SimulationRuntimeHost | null {
    const artifact = input.artifacts.getArtifact<SimulationSourceArtifact>('simulation', input.model.id ?? input.model.identity)
    if (!artifact || artifact.status === 'error') {
      return null
    }
    // Политика текущего запуска не меняется при сохранении нового Source в Domain.
    const artifacts: RuntimeArtifactReader = {
      getArtifact: <T>(entityType: Parameters<RuntimeArtifactReader['getArtifact']>[0], id: string | number) => {
        const root = entityType === 'simulation'
          && (String(id) === String(artifact.ref.id) || String(id) === artifact.ref.identity)
        return root ? artifact as ProgramArtifact<T> : input.artifacts.getArtifact<T>(entityType, id)
      },
    }
    const overrides = prepareSimulationOverrides(artifact.payload, artifacts, input.model.identity)
    const host = new SimulationRuntimeHost({ ...input, artifacts, overrides })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: { type: 'simulation', runtimeId: input.id, entityIdentity: input.model.identity },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    return host
  }

  public get target(): CompositionRuntimeHost<'composition' | 'project'> | null {
    return this._target
  }

  /** Проверяет occurrence, а не глобальную identity Query. */
  public hasRequest(host: RuntimeHost<any, any>): boolean {
    const key = this._requestKey(host)
    return key !== null && this._responses.has(key)
  }

  /** Каждое выполнение получает новый response; mutation Query не меняет шаблон следующего вызова. */
  public readResponse(host: RuntimeHost<any, any>): { value: unknown } | null {
    const key = this._requestKey(host)
    return key !== null && this._responses.has(key)
      ? { value: JSON.parse(JSON.stringify(this._responses.get(key))) }
      : null
  }

  public streamOverride(host: RuntimeHost<any, any>) {
    const key = this._requestKey(host)
    return key == null ? null : this._overrides.streams.get(key) ?? null
  }

  public openStream(host: RuntimeHost<any, any>, callbacks: Parameters<StreamTransportFactory['open']>[1]) {
    const override = this.streamOverride(host)
    if (!override || !this._generator) {
      throw new Error('[Simulation] Mock generator adapter недоступен.')
    }
    return this._generator.openStream(override.schema, override.options, callbacks)
  }

  private _requestKey(host: RuntimeHost<any, any>): string | null {
    if (host.entityType !== 'query' && host.entityType !== 'stream') {
      return null
    }
    const path: string[] = []
    let current = host
    while (current.parent && current.parent !== this) {
      if ((current.parent.entityType !== 'composition' && current.parent.entityType !== 'project') || typeof current.meta.instance !== 'string') {
        return null
      }
      path.unshift(current.meta.instance)
      current = current.parent
    }
    return current === this._target ? JSON.stringify(path) : null
  }

  /** Создаёт target штатной strategy; вложенные manual nodes сохраняют свои policies. */
  public activateTarget(): Promise<CompositionRuntimeHost<'composition' | 'project'>> {
    if (this._closed) {
      return Promise.reject(new Error('[Simulation] Запуск уже закрыт.'))
    }
    if (this._activation) {
      return this._activation
    }
    const generation = this._generation
    this._abortController = new AbortController()
    const signal = this._abortController.signal
    const activation = this._enqueue(async () => {
      this._assertCurrent(generation)
      if (this._target) {
        await this._target.getScope('scope_default')?.activate()
        this._assertCurrent(generation)
        return this._target
      }
      if ((this._overrides.requests.size || this._overrides.streams.size) && !this._generator) {
        throw new Error('[Simulation] Для подмен требуется внешний mock generator adapter.')
      }
      if (this._overrides.requests.size && !this._responses.size) {
        const responses = new Map<string, unknown>()
        for (const [key, request] of this._overrides.requests) {
          responses.set(key, await this._generator!.generate(request.schema, request.seed, signal))
          this._assertCurrent(generation)
        }
        this._responses = responses
      }
      const payload = this.getArtifactPayload()!
      const model = payload.target.entityType === 'project'
        ? Endge.domain.getProject(payload.target.identity)
        : Endge.domain.getComposition(payload.target.identity)
      if (!model) {
        throw new Error(`[Simulation] Target "${payload.target.identity}" отсутствует.`)
      }
      if (!this._scope) {
        this._scope = Endge.runtime.scopes.register(new RuntimeScope({
          id: `${this.id}:scope:simulation`,
          path: 'simulation',
          boundaryId: `${this.id}:scope:simulation`,
          parent: Endge.runtime.getRuntimeScopeByHost(this.id),
          ownerRuntimeId: this.id,
          hooks: { destroyRuntime: id => Endge.runtime.destroyRuntimeTreeAsync(id) },
        }))
      }
      await this._scope.activate()
      this._assertCurrent(generation)
      const target = Endge.runtime.execute(model, {
        parent: this,
        artifactReader: this.getArtifactReader()!,
        persistence: 'disabled',
        meta: {
          runtimeScopeId: this._scope.id,
          input: { kind: 'local', props: this.meta.targetProps ?? {} },
        },
      }) as CompositionRuntimeHost<'composition' | 'project'> | null
      if (!target) {
        throw new Error(`[Simulation] Не удалось создать target "${payload.target.identity}".`)
      }
      this._target = target
      const startedAt = new Date().toISOString()
      this.setContext({ status: 'running', startedAt, updatedAt: startedAt })
      try {
        await target.mountGraph()
        this._assertCurrent(generation)
        this.setContext({ status: 'success', updatedAt: new Date().toISOString() })
        return target
      }
      catch (error) {
        await Endge.runtime.destroyRuntimeTreeAsync(target.id)
        if (this._target === target) {
          this._target = null
        }
        this.setContext({ status: 'error', updatedAt: new Date().toISOString() })
        throw error
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

  public deactivateTarget(): Promise<void> {
    this._abortController.abort()
    this._generation += 1
    this._activation = null
    this._target?.quiesce()
    return this._enqueue(async () => {
      const target = this._target
      this._target = null
      if (target) {
        await Endge.runtime.destroyRuntimeTreeAsync(target.id)
      }
    })
  }

  public override async pause(): Promise<void> {
    await this._scope?.pause()
    super.pause()
  }

  public override async resume(): Promise<void> {
    if (this._closed) {
      return
    }
    await this._scope?.activate()
    super.resume()
  }

  public override quiesce(): void {
    this._closed = true
    this._abortController.abort()
    this._generation += 1
    this._target?.quiesce()
    super.quiesce()
  }

  public override destroy(): Promise<void> {
    if (!this._destroying) {
      this.quiesce()
      this._destroying = this._dispose()
    }
    return this._destroying
  }

  private async _dispose(): Promise<void> {
    const errors: unknown[] = []
    try {
      await this.deactivateTarget()
    }
    catch (error) {
      errors.push(error)
    }
    if (this._scope) {
      try {
        await Endge.runtime.scopes.remove(this._scope.id)
      }
      catch (error) {
        errors.push(error)
      }
      this._scope = null
    }
    this._responses = new Map()
    super.destroy()
    if (errors.length) {
      throw new AggregateError(errors, '[Simulation] Ошибка освобождения запуска.')
    }
  }

  private _assertCurrent(generation: number): void {
    if (this._closed || this._generation !== generation) {
      throw new DOMException('[Simulation] Активация отменена.', 'AbortError')
    }
  }

  private _enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this._transition.then(operation, operation)
    this._transition = next.then(() => undefined, () => undefined)
    return next
  }
}
