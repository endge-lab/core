import type { ControllerContext, ControllerDefinition, ControllerDependency, ControllerInstance, ControllerModel, ControllerProgramPayload, ControllerProvider } from '../domain/controllers/controller.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostSnapshot } from '../domain/runtime-host.types'
import type { TypeProgramCatalogEntry } from '@/features/core/modules/source/domain/types/type-source.types'
import { Raph, RaphNode } from '@raphy-js/raph'
import { evaluateSourceExpression } from '@/features/core/modules/source/services/source-expression-evaluate'
import { RuntimeHostBase } from '../RuntimeHostBase'
import { validateControllerValue } from '../services/controllers/controller-values'

export class ControllerRuntimeHost extends RuntimeHostBase<'controller', import('../domain/runtime-host.types').RuntimeHostContextBase, ControllerProgramPayload> {
  private _props: Record<string, unknown>
  private _instance!: ControllerInstance
  private _abort = new AbortController()
  private readonly _cleanups: Array<() => void>
  private _dead = false
  private _readyDone = false
  private _startStarted = false
  private _resolveReady: () => void = () => {}
  private _rejectReady: (error: unknown) => void = () => {}
  private _ready: Promise<void> = Promise.resolve()
  private readonly _definition: ControllerDefinition
  private readonly _disposeRuntime: () => Promise<void>
  private readonly _catalog: readonly TypeProgramCatalogEntry[]
  private readonly _omittedProviderOutputs: ReadonlySet<string>
  private readonly _contextCurrent: () => boolean
  private _generation = 0
  private readonly _dependencies: Record<string, ControllerDependency>
  private _destruction: Promise<void> | null = null
  public constructor(input: {
    id: string
    model: ControllerModel
    parent: RuntimeHost<any, any> | null
    meta: Record<string, unknown>
    artifacts: RuntimeArtifactReader
    definition: ControllerDefinition
    provider: ControllerProvider
    dependencies: Record<string, ControllerDependency>
    cleanups: Array<() => void>
    catalog: readonly TypeProgramCatalogEntry[]
    disposeRuntime: () => Promise<void>
    omittedProviderOutputs?: readonly string[]
    contextCurrent: () => boolean
    subscribeContext: (listener: () => void) => () => void
  }) {
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: describeMeta(input.meta),
      kind: 'controller',
      runtimeType: 'controller-runtime-host',
      entityType: 'controller',
      entityIdentity: input.definition.identity,
      title: input.definition.displayName,
      context: {
        status: 'idle',
        startedAt: null,
        updatedAt: null,
      },
      artifactReader: input.artifacts,
      artifactRef: {
        entityType: 'controller',
        id: input.model.id,
        identity: input.model.identity,
      },
    })
    this._omittedProviderOutputs = new Set(input.omittedProviderOutputs ?? [])
    this._contextCurrent = input.contextCurrent
    this._disposeRuntime = input.disposeRuntime
    this._dependencies = input.dependencies
    this._definition = input.definition
    this._catalog = input.catalog
    this._cleanups = input.cleanups
    this._props = Object.fromEntries(input.definition.contract.props.flatMap(field => field.defaultValue
      ? [[field.key, evaluateSourceExpression(field.defaultValue, {
          scope: {},
        })]]
      : []))
    Object.assign(this._props, structuredClone(input.meta.props ?? {}))
    this._validateProps(this._props)
    this.addRaphNode(new RaphNode(Raph.runtime(), {
      id: `${input.id}:controller`,
    }))
    const context = this._executionContext()
    try {
      this._instance = input.provider.create(context)
    }
    catch (error) {
      this._dead = true
      this._invalidate()
      this._cleanups.splice(0).forEach(dispose => dispose())
      super.destroy()
      throw error
    }
    this._cleanups.push(input.subscribeContext(() => {
      if (!this._contextCurrent()) {
        void this.pause().catch(error => this._fail(error))
      }
    }))
    this.addResource({
      id: 'controller',
      kind: 'meta',
      title: input.definition.identity,
      payload: {
        definition: input.definition,
        dependencies: Object.keys(input.dependencies),
      },
    })
  }

  public override create(): void {
    super.create()
    this._ready = new Promise<void>((resolve, reject) => {
      this._resolveReady = resolve
      this._rejectReady = reject
    })
    // The registry starts synchronously; mount()/commands observe the same readiness.
    void this._ready.catch(() => {})
    void Promise.resolve().then(() => this._startOnce()).catch(() => {})
  }

  private async _startOnce(): Promise<void> {
    if (this._dead || this.status === 'paused') {
      return
    }
    if (this._startStarted) {
      await this._ready
      return
    }
    this._startStarted = true
    try {
      await this._instance.start?.(this._executionContext())
      if (this._dead) {
        throw new DOMException('Controller is inactive.', 'AbortError')
      }
      this._readyDone = true
      this._resolveReady()
    }
    catch (error) {
      if (!this._dead) {
        this._fail(error)
      }
      this._rejectReady(error)
      throw error
    }
  }

  public dispose(): Promise<void> {
    return this._disposeRuntime()
  }

  public whenReady(): Promise<void> {
    return this._ready
  }

  public override snapshot(): RuntimeHostSnapshot {
    const snapshot = super.snapshot()
    snapshot.meta = { ...snapshot.meta, props: this.getProps() }
    return snapshot
  }

  public getProps(): Readonly<Record<string, unknown>> {
    return structuredClone(this._props)
  }

  public getOutputs(): Readonly<Record<string, unknown>> {
    return structuredClone(Raph.get(`${this.basePath}.outputs`) as Record<string, unknown> ?? {})
  }

  public getOutput(name: string): unknown {
    return this.getOutputs()[name]
  }

  public override outputPath(name: string): string {
    return `${this.basePath}.outputs.${name}`
  }

  public async setProps(patch: Record<string, unknown>): Promise<void> {
    this._assertActive()
    const props = {
      ...this._props,
      ...structuredClone(patch),
    }
    this._validateProps(props)
    if (JSON.stringify(props) === JSON.stringify(this._props)) {
      return
    }
    this._props = props
    await this._ready
    this._assertActive()
    this._invalidate()
    await this._instance.setProps?.(freeze(structuredClone(props)), this._executionContext())
  }

  public async command(name: string, input?: unknown): Promise<unknown> {
    this._assertActive()
    if (!this._readyDone) {
      await this._ready
    }
    this._assertActive()
    const contract = Object.hasOwn(this._definition.contract.commands, name) ? this._definition.contract.commands[name] : undefined
    if (!contract) {
      throw new Error(`controller-command-missing: ${name}`)
    }
    if (contract.input) {
      validateControllerValue(contract.input, input, this._catalog)
    }
    const context = this._executionContext()
    const result = await this._instance.command(name, structuredClone(input), context)
    if (context.signal.aborted) {
      throw new DOMException('Controller execution superseded.', 'AbortError')
    }
    this._assertActive()
    if (contract.output) {
      validateControllerValue(contract.output, result, this._catalog)
    }
    return result
  }

  public subscribe(listener: () => void): () => void {
    this.on('outputs:change', listener)
    return () => this.off('outputs:change', listener)
  }

  private _invalidate(): void {
    this._generation++
    this._abort.abort()
    this._abort = new AbortController()
  }

  private _executionContext(): ControllerContext {
    const generation = this._generation
    const signal = this._abort.signal
    const props = freeze(structuredClone(this._props))
    const assertCurrent = () => {
      if (signal.aborted || generation !== this._generation || this._dead || !this._contextCurrent()) {
        throw new DOMException('Controller execution superseded.', 'AbortError')
      }
    }
    const dependencies: Record<string, ControllerDependency> = {}
    for (const [name, dependency] of Object.entries(this._dependencies)) {
      if (dependency.kind === 'store') {
        dependencies[name] = {
          ...dependency,
          read: () => {
            assertCurrent()
            return dependency.read()
          },
          commit: (next, revision) => {
            assertCurrent()
            dependency.commit(next, revision)
          },
          subscribe: (listener) => {
            assertCurrent()
            const unsubscribe = dependency.subscribe(() => {
              if (!signal.aborted && generation === this._generation && !this._dead && this._contextCurrent()) {
                listener()
              }
            })
            let disposed = false
            const dispose = () => {
              if (disposed) {
                return
              }
              disposed = true
              signal.removeEventListener('abort', dispose)
              unsubscribe()
            }
            signal.addEventListener('abort', dispose, { once: true })
            return dispose
          },
        }
      }
      else {
        const cache = dependency.cache
        dependencies[name] = {
          kind: 'query',
          ...(cache
            ? { cache: {
                options: cache.options,
                select: async (selection) => {
                  assertCurrent()
                  await cache.select(selection)
                  assertCurrent()
                },
                read: async (request) => {
                  assertCurrent()
                  const result = await cache.read(request)
                  assertCurrent()
                  return result
                },
                write: async (request, value, requestedAt) => {
                  assertCurrent()
                  await cache.write(request, value, requestedAt)
                  assertCurrent()
                },
                clear: async (structuralChange) => {
                  assertCurrent()
                  await cache.clear(structuralChange)
                  assertCurrent()
                },
                status: () => {
                  assertCurrent()
                  return cache.status()
                },
                subscribe: (listener) => {
                  assertCurrent()
                  const remove = cache.subscribe(() => {
                    if (!signal.aborted) {
                      listener()
                    }
                  })
                  const dispose = () => {
                    signal.removeEventListener('abort', dispose)
                    remove()
                  }
                  signal.addEventListener('abort', dispose, { once: true })
                  return dispose
                },
              } }
            : {}),
          run: async (input, externalSignal) => {
            assertCurrent()
            const combined = new AbortController()
            const cancel = () => combined.abort()
            if (externalSignal.aborted) {
              combined.abort()
            }
            signal.addEventListener('abort', cancel, {
              once: true,
            })
            externalSignal.addEventListener('abort', cancel, {
              once: true,
            })
            try {
              const result = await dependency.run(input, combined.signal)
              assertCurrent()
              return result
            }
            finally {
              signal.removeEventListener('abort', cancel)
              externalSignal.removeEventListener('abort', cancel)
            }
          },
        }
      }
    }
    return {
      props,
      signal,
      dependencies,
      publish: (outputs) => {
        if (!signal.aborted && generation === this._generation && !this._dead && this._contextCurrent()) {
          this._publish(outputs)
        }
      },
    }
  }

  private _validateProps(props: Record<string, unknown>): void {
    for (const key of Object.keys(props)) {
      if (!this._definition.contract.props.some(field => field.key === key)) {
        throw new Error(`controller-prop-unknown: ${key}`)
      }
    }
    for (const field of this._definition.contract.props) {
      validateControllerValue(field, props[field.key], this._catalog)
    }
  }

  private _publish(values: Record<string, unknown>): void {
    if (this._dead || ['paused', 'pausing', 'stopping', 'stopped', 'destroyed'].includes(this.status)) {
      return
    }
    if (this._omittedProviderOutputs.size) {
      values = Object.fromEntries(Object.entries(values).filter(([key]) => !this._omittedProviderOutputs.has(key)))
    }
    for (const [key, value] of Object.entries(values)) {
      const field = this._definition.contract.outputs.find(field => field.key === key)
      if (!field) {
        throw new Error(`controller-output-unknown: ${key}`)
      }
      validateControllerValue(field, value, this._catalog)
    }
    Raph.batch(() => {
      for (const [key, value] of Object.entries(values)) {
        Raph.set(this.outputPath(key), structuredClone(value))
      }
    })
    this.setContext({
      status: 'success',
      updatedAt: new Date().toISOString(),
    })
    this.emit('outputs:change', {
      outputs: this.getOutputs(),
    })
  }

  private _fail(error: unknown): void {
    this.setContext({
      status: 'error',
      updatedAt: new Date().toISOString(),
    })
    this.emit('controller:error', {
      error,
    })
  }

  private _assertActive(): void {
    this._assertExecutionContext()
    if (this._dead || !['active', 'running', 'mounted'].includes(this.status)) {
      throw new DOMException('Controller is inactive.', 'AbortError')
    }
  }

  public override async pause(): Promise<void> {
    if (this._dead || !['active', 'running'].includes(this.status)) {
      return
    }
    super.pause()
    this._invalidate()
    await this._instance.pause?.()
  }

  private _assertExecutionContext(): void {
    if (!this._contextCurrent()) {
      throw new DOMException('Controller execution context changed. Remount the owner scope.', 'AbortError')
    }
  }

  public override async resume(): Promise<void> {
    this._assertExecutionContext()
    if (this._dead || this.status !== 'paused') {
      return
    }
    super.resume()
    await this._startOnce()
    this._assertActive()
    await this._instance.resume?.(this._executionContext())
  }

  public override quiesce(): void {
    if (!this._dead) {
      this._dead = true
      this._invalidate()
      this._rejectReady(new DOMException('Controller is inactive.', 'AbortError'))
    }
    ;
    super.quiesce()
  }

  public override stop(): void {
    this.quiesce()
    super.stop()
  }

  public override destroy(): Promise<void> {
    if (!this._destruction) {
      this.quiesce()
      this._destruction = (async () => {
        try {
          await this._instance?.destroy?.()
        }
        finally {
          this._cleanups.splice(0).reverse().forEach(dispose => dispose())
          super.destroy()
        }
      })()
    }
    return this._destruction
  }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      freeze(child)
    }
  }
  ;
  return value
}

function describeMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const bindings = (meta.controllerDependencies ?? {}) as Record<string, { store?: { id: string }, path?: string, update?: string, query?: string, output?: string }>
  return {
    ...meta,
    props: structuredClone(meta.props ?? {}),
    controllerDependencies: Object.fromEntries(Object.entries(bindings).map(([name, binding]) => [name, binding.store
      ? { kind: 'store', storeRuntimeId: binding.store.id, path: binding.path, update: binding.update }
      : { kind: 'query', query: binding.query, output: binding.output }])),
  }
}
