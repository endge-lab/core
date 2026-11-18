import type { ProgramArtifact, ProgramEntityType } from '../program/domain/types/program.types'
import type { ControllerDefinition, ControllerDependency, ControllerModel, ControllerMountOptions, ControllerProgramPayload, ControllerProvider } from './domain/controllers/controller.types'
import type { RuntimeArtifactReader } from './domain/runtime-host.types'
import type { AnyRuntimeHost } from './domain/runtime-strategy.types'
import { Endge } from '@/features/core/kernel/endge'
import { EndgeModule } from '@/features/federation/EndgeModule'
import { ControllerRuntimeHost } from './hosts/ControllerRuntimeHost'
import { StoreRuntimeHost } from './hosts/StoreRuntimeHost'
import { collectionWindowDefinition } from './services/controllers/builtins/collection-window.definition'
import { CollectionWindowController } from './services/controllers/builtins/CollectionWindowController'
import { pageCacheJson, PageCacheService } from './services/controllers/cache/PageCacheService'
import { ControllerRegistry } from './services/controllers/ControllerRegistry'
import { findSimulationRuntime } from './services/simulation/find-simulation-runtime'

export class EndgeControllers_Module extends EndgeModule {
  private readonly _registry = new ControllerRegistry()
  private readonly _writers = new Map<string, string>()
  private readonly _pageCaches = new PageCacheService()

  public resetPageCaches(): Promise<void> {
    return this._pageCaches.reset()
  }

  public constructor() {
    super()
    this._registry.define(collectionWindowDefinition)
    this._registry.provide({
      identity: collectionWindowDefinition.identity,
      key: collectionWindowDefinition.defaultProviderKey,
      create: context => new CollectionWindowController(context),
    })
  }

  public define(definition: ControllerDefinition): () => void {
    const remove = this._registry.define(definition)
    this.notify()
    return () => {
      remove()
      this.notify()
    }
  }

  public provide(provider: ControllerProvider): () => void {
    const remove = this._registry.provide(provider)
    this.notify()
    return () => {
      remove()
      this.notify()
    }
  }

  public list(): ControllerDefinition[] {
    return this._registry.list()
  }

  public get(identity: string): ControllerDefinition | null {
    return this._registry.get(identity)
  }

  public model(identity: string): ControllerModel {
    const definition = this._registry.get(identity)
    if (!definition) {
      throw new Error(`controller-definition-missing: ${identity}`)
    }
    return {
      type: 'controller',
      id: identity,
      identity,
      name: definition.displayName,
    }
  }

  public async mount(identity: string, options: ControllerMountOptions): Promise<ControllerRuntimeHost> {
    const parent = typeof options.owner === 'string' ? Endge.runtime.getRuntimeById(options.owner) : options.owner
    if (!parent || Endge.runtime.getRuntimeById(parent.id) !== parent || ['destroyed', 'paused', 'stopped'].includes(parent.status)) {
      throw new Error('controller-owner-required')
    }
    Endge.compiler.buildController(identity)
    const host = Endge.runtime.execute(this.model(identity), {
      parent,
      instanceId: options.instanceId,
      meta: {
        props: options.props ?? {},
        controllerDependencies: options.dependencies ?? {},
      },
    }) as ControllerRuntimeHost | null
    if (!host) {
      throw new Error(`controller-mount-failed: ${identity}`)
    }
    try {
      await host.whenReady()
      if (Endge.runtime.getRuntimeById(host.id) !== host || Endge.runtime.getRuntimeById(parent.id) !== parent || ['destroyed', 'stopped'].includes(host.status)) {
        throw new DOMException('Controller is inactive.', 'AbortError')
      }
      return host
    }
    catch (error) {
      await Endge.runtime.destroyRuntimeTreeAsync(host.id)
      throw error
    }
  }

  private _queryFingerprint(root: ProgramArtifact, reader: RuntimeArtifactReader): string {
    const versions = new Map<string, unknown>()
    const visit = (artifact: ProgramArtifact): void => {
      const key = `${artifact.ref.entityType}:${artifact.ref.identity || artifact.ref.id}`
      if (versions.has(key)) {
        return
      }
      versions.set(key, [artifact.sourceHash, artifact.compilerVersion, artifact.contextHash])
      for (const child of artifact.children ?? []) {
        visit(child)
      }
      for (const dependency of artifact.dependencies) {
        if (dependency.validationOnly) {
          continue
        }
        const next = reader.getArtifact(dependency.entityType as ProgramEntityType, dependency.identity ?? dependency.id)
        if (next) {
          visit(next)
        }
        else { versions.set(`${dependency.entityType}:${dependency.identity ?? dependency.id}`, null) }
      }
    }
    visit(root)
    return pageCacheJson(Object.fromEntries(versions))
  }

  public create(input: {
    id: string
    model: ControllerModel
    parent: AnyRuntimeHost | null
    meta: Record<string, unknown>
    artifacts: RuntimeArtifactReader
  }): ControllerRuntimeHost | null {
    const artifact = input.artifacts.getArtifact<ControllerProgramPayload>('controller', input.model.identity)
    if (!artifact || artifact.status === 'error') {
      return null
    }
    const definition = artifact.payload.definition
    const lease = this._registry.acquire(definition)
    const provider = lease.provider
    const bindings = (input.meta.controllerDependencies ?? {}) as NonNullable<ControllerMountOptions['dependencies']>
    const dependencies: Record<string, ControllerDependency> = {}
    const cleanups: Array<() => void> = [lease.release]
    try {
      for (
        const [name, contract] of Object.entries(definition.contract.dependencies)) {
        const binding = bindings[name]
        if (!binding && contract.optional) {
          continue
        }
        if (!binding) {
          throw new Error(`controller-dependency-required: ${name}`)
        }
        if (contract.kind === 'store' && 'store' in binding) {
          if (Object.keys(binding).some(key => !['store', 'path', 'update'].includes(key))) {
            throw new Error('controller-store-binding-field-unknown')
          }
          const store = binding.store
          if (!(store instanceof StoreRuntimeHost) || Endge.runtime.getRuntimeById(store.id) !== store || !store.isWritable(binding.path)) {
            throw new Error('controller-state-invalid')
          }
          const update = input.artifacts.getArtifact<import('@/features/core/modules/source/domain/types/update-source.types').UpdateSourceArtifact>('update', binding.update)
          if (!update || update.status === 'error' || update.payload.storeIdentity !== store.entityIdentity || !update.payload.mutations.some(mutation => mutation.target === binding.path)) {
            throw new Error('controller-update-owner-or-target')
          }
          const key = `${store.id}\u0000${binding.path}`
          if (this._writers.has(key)) {
            throw new Error('controller-state-already-owned')
          }
          this._writers.set(key, input.id)
          cleanups.push(() => {
            if (this._writers.get(key) === input.id) {
              this._writers.delete(key)
            }
          })
          const read = () => store.get(binding.path)
          dependencies[name] = {
            kind: 'store',
            read,
            commit: (next, expectedRevision) => {
              if ((read() as {
                revision: number
              })?.revision !== expectedRevision) {
                throw new Error('controller-state-revision-conflict')
              }
              store.applyUpdate(binding.update, {
                expectedRevision,
                next,
              })
              if ((read() as {
                revision: number
              })?.revision !== next.revision) {
                throw new Error('controller-state-commit-rejected')
              }
            },
            subscribe: (listener) => {
              store.on('state:change', listener)
              return () => store.off('state:change', listener)
            },
          }
        }
        else
          if (contract.kind === 'query' && 'query' in binding) {
            if (Object.keys(binding).some(key => !['query', 'output', 'cache'].includes(key))) {
              throw new Error('controller-query-binding-field-unknown')
            }
            const query = Endge.domain.getQuery(binding.query)
            const queryArtifact = input.artifacts.getArtifact<import('@/features/core/modules/program/domain/types/program.types').QueryProgramPayload>('query', binding.query)
            if (!query || !queryArtifact || queryArtifact.status === 'error' || !queryArtifact.payload.outputs.some(output => output.key === binding.output)) {
              throw new Error('controller-query-output-missing')
            }
            const fingerprint = binding.cache ? this._queryFingerprint(queryArtifact, input.artifacts) : undefined
            dependencies[name] = {
              kind: 'query',
              ...(binding.cache !== undefined
                ? { cache: this._pageCaches.create(binding.cache, () => ({
                    context: { ...Endge.context.serialize(), user: Endge.context.getCurrentUser() },
                    mode: Endge.runtime.resolveDataMode(Endge.runtime.getRuntimeById(input.id)),
                    query: binding.query,
                    output: binding.output,
                    source: queryArtifact.sourceHash,
                    fingerprint,
                    compiler: queryArtifact.compilerVersion,
                    contextHash: queryArtifact.contextHash,
                    simulation: (() => {
                      const simulation = findSimulationRuntime(Endge.runtime.getRuntimeById(input.id))
                      return simulation
                        ? {
                            id: simulation.id,
                            policy: simulation.getArtifactPayload(),
                          }
                        : null
                    })(),
                  })) }
                : {}),
              run: async (props, signal) => {
                const parent = Endge.runtime.getRuntimeById(input.id)
                if (!parent || signal.aborted) {
                  throw new DOMException('Controller cancelled.', 'AbortError')
                }
                const outputs = await Endge.runtime.query.run(query, props, parent, {
                  signal,
                  artifactReader: input.artifacts,
                })
                if (signal.aborted) {
                  throw new DOMException('Controller cancelled.', 'AbortError')
                }
                return outputs[binding.output]
              },
            }
          }
          else {
            throw new Error(`controller-dependency-kind: ${name}`)
          }
      }
      for (
        const name of Object.keys(bindings)) {
        if (!Object.hasOwn(definition.contract.dependencies, name)) {
          throw new Error(`controller-dependency-unknown: ${name}`)
        }
      }
      const contextKey = () => pageCacheJson([Endge.context.getCurrentWorkspace(), Endge.context.getFacetSelections(), Endge.context.getCurrentUser(), Endge.context.dataMode])
      const mountedContext = contextKey()
      return new ControllerRuntimeHost({
        ...input,
        definition,
        provider,
        dependencies,
        cleanups,
        catalog: Endge.program.getTypeCatalog(),
        omittedProviderOutputs: definition.identity === collectionWindowDefinition.identity && provider.key === collectionWindowDefinition.defaultProviderKey
          ? collectionWindowDefinition.contract.outputs.filter(field => field.optional && !definition.contract.outputs.some(old => old.key === field.key)).map(field => field.key)
          : [],
        contextCurrent: () => contextKey() === mountedContext,
        subscribeContext: listener => Endge.context.subscribe(listener),
        disposeRuntime: () => Endge.runtime.destroyRuntimeTreeAsync(input.id),
      })
    }
    catch (error) {
      cleanups.splice(0).reverse().forEach(dispose => dispose())
      throw error
    }
  }
}
