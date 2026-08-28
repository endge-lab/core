import type { PhaseEvent, RaphDerivedHandle } from '@endge/raph'
import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { ProgramArtifact, QueryProgramPayload } from '@/domain/types/program/program.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext, RuntimeHostUpdateContext } from '@/domain/types/runtime/runtime-host.types'
import type { FilterProgramPayload } from '@/domain/types/source/filter-source.types'

import type { FilterRuntimeHost } from '@/model/runtime/hosts/FilterRuntimeHost'

import { collectionByKey, filterByKey, full, Raph, RaphNode } from '@endge/raph'
import { RFilter as FilterModel } from '@/domain/entities/reflect/RFilter'
import { Endge } from '@/model/kernel/endge'
import { runResponseOutputTransforms } from '@/model/modules/runtime/execution/endge-response-output'
import { RuntimeHostBase } from '@/model/runtime/RuntimeHostBase'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

function defaultContext(): RuntimeHostContext<'query'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    lastFilterChangeAt: null,
  }
}

/** Executable Query runtime с props, child filters и latest-wins. */
export class QueryRuntimeHost extends RuntimeHostBase<'query', RuntimeHostContext<'query'>, QueryProgramPayload> {
  private _props: Record<string, unknown> = {}
  private _outputs: Record<string, unknown> = {}
  private _outputGeneration = 0
  private _runSequence = 0
  private _abortController: AbortController | null = null
  private _filterChildIds = new Set<string>()
  private _derivedHandles: RaphDerivedHandle[] = []
  private _outputWatchers: Array<() => void> = []
  private _outputPaths = new Map<string, string>()
  private _outputDependents = new Map<string, Set<string>>()
  private _responseInputPaths = new Map<string, string>()
  private readonly _internalBase: string
  private _derivedErrorActive = false
  private _contextOff: (() => void) | null = null
  private _isMockEnabled = false

  public constructor(input: {
    id: string
    model: RQuery
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
    artifactReader?: RuntimeArtifactReader
    entityIdentity?: string
    title?: string
  }) {
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      kind: 'query',
      runtimeType: 'query-runtime-host',
      entityType: 'query',
      entityIdentity: input.entityIdentity ?? input.model.identity ?? String(input.model.id),
      title: input.title ?? input.model.name ?? input.model.identity ?? `Query ${input.model.id}`,
      context: defaultContext(),
      artifactReader: input.artifactReader ?? Endge.program,
      artifactRef: { entityType: 'query', id: input.model.id, identity: input.model.identity },
    })
    this._internalBase = this.basePath
  }

  public static createRuntime(input: {
    id: string
    model: RQuery
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifacts: RuntimeArtifactReader
  }): QueryRuntimeHost | null {
    const artifact = input.artifacts.getArtifact<QueryProgramPayload>('query', input.model.id ?? input.model.identity)
    if (!artifact || artifact.status === 'error') {
      return null
    }

    const host = new QueryRuntimeHost({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      artifactReader: input.artifacts,
    })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: {
        type: 'query',
        runtimeId: input.id,
        entityIdentity: input.model.identity,
        parentRuntimeId: input.parent?.id ?? null,
      },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    host._props = host._literalDefaults(artifact.payload)
    host._applyProps(host._props, true)
    host._applyProps(input.meta?.props ?? {}, true)
    host._isMockEnabled = Endge.runtime.resolveDataMode(host) === 'mock'
    host._contextOff = Endge.context.subscribe(() => {
      const isMockEnabled = Endge.runtime.resolveDataMode(host) === 'mock'
      if (isMockEnabled === host._isMockEnabled) {
        return
      }
      host._isMockEnabled = isMockEnabled
      if (!isMockEnabled) {
        return
      }
      host._runSequence += 1
      host._abortController?.abort()
    })
    try {
      host._mountOutputGraph(artifact)
    }
    catch (error) {
      host.destroy()
      throw error
    }
    return host
  }

  /** Активирует зарегистрированный Query host и создаёт его child filters. */
  public override create(): void {
    if (this.status === 'active') {
      return
    }
    this._initializeDefaultSources()
    super.create()
  }

  /** Создает unresolved Filter defaults после регистрации Query host. */
  private _initializeDefaultSources(): void {
    const payload = this.getArtifactPayload()
    const artifact = this.getArtifact()
    if (!payload || !artifact) {
      return
    }

    for (const prop of payload.props) {
      if (Object.hasOwn(this._props, prop.key) || !prop.defaultSource) {
        continue
      }

      const source = prop.defaultSource
      let model: RFilter | null = null
      let childArtifact: ProgramArtifact<FilterProgramPayload> | null = null
      if (source.kind === 'filter') {
        model = Endge.domain.getFilter(source.identity)
      }
      else if (source.kind === 'local-filter') {
        childArtifact = findChildFilterArtifact(artifact.children ?? [], source.ref)
        if (childArtifact) {
          model = new FilterModel()
          model.id = childArtifact.ref.id as number
          model.identity = childArtifact.ref.identity
          model.name = childArtifact.ref.identity
          model.displayName = childArtifact.ref.identity
          model.sourceVersion = childArtifact.payload.sourceVersion
        }
      }
      if (!model) {
        continue
      }

      const child = Endge.runtime.execute(model, {
        parent: this,
        persistence: 'disabled',
        meta: {
          instance: `default-filter:${prop.key}`,
          artifact: childArtifact ?? undefined,
        },
      }) as FilterRuntimeHost | null
      if (!child) {
        continue
      }

      this.bindInput(prop.key, { kind: 'raph', path: child.outputPath(source.output) })
      this._filterChildIds.add(child.id)
    }
  }

  public getProps(): Readonly<Record<string, unknown>> {
    return this.readInputs()
  }

  public setProps(patch: Record<string, unknown>): void {
    this._applyProps(patch, false)
  }

  public getOutput(name: string): unknown {
    const key = String(name ?? '').trim()
    const path = this._outputPaths.get(key)
    return path ? Raph.get(path) : this._outputs[key]
  }

  public getOutputs(): Readonly<Record<string, unknown>> {
    if (!this._outputPaths.size) {
      return { ...this._outputs }
    }
    return Object.fromEntries([...this._outputPaths].map(([key, path]) => [key, Raph.get(path)]))
  }

  public async run(propsPatch?: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (propsPatch) {
      this._applyProps(propsPatch, false)
    }

    this._isMockEnabled = Endge.runtime.resolveDataMode(this) === 'mock'
    if (this._isMockEnabled) {
      this._runSequence += 1
      this._abortController?.abort()
      const updatedAt = new Date().toISOString()
      this.setContext({ status: 'success', updatedAt })
      this.emit('run:skipped', { reason: 'mock-mode' })
      return this.getOutputs() as Record<string, unknown>
    }

    const payload = this.getArtifactPayload()
    const artifact = this.getArtifact()
    if (!payload || !artifact) {
      throw new Error(`[QueryRuntimeHost] Query artifact is missing for "${this.entityIdentity}".`)
    }

    const sequence = ++this._runSequence
    this._abortController?.abort()
    this._abortController = new AbortController()
    const startedAt = new Date().toISOString()
    this.setContext({ status: 'running', startedAt, updatedAt: startedAt })

    try {
      const response = await Endge.runtime.query.executeArtifact({
        payload,
        props: this.readInputs(),
        signal: this._abortController.signal,
      })
      if (sequence !== this._runSequence) {
        return this.getOutputs() as Record<string, unknown>
      }

      if (!payload.outputs.length) {
        this._outputs = response && typeof response === 'object' && !Array.isArray(response)
          ? response as Record<string, unknown>
          : { result: response }
        this._publishOutputs(Object.keys(this._outputs))
      }
      else {
        Raph.transaction(() => {
          for (const output of payload.outputs) {
            if (output.source.type !== 'response') {
              continue
            }
            const path = output.materialization.kind === 'source'
              ? this._requireOutputPath(output.key)
              : this._requireResponseInputPath(output.key)
            Raph.set(path, Endge.runtime.query.readResponseOutput(output, response))
          }
          // A response is a new data generation even when its values are
          // referentially or structurally equal to the previous generation.
          Raph.set(`${this._internalBase}.outputGeneration`, ++this._outputGeneration)
        })
      }
      const updatedAt = new Date().toISOString()
      this.setContext({ status: 'success', updatedAt })
      const outputs = this.getOutputs() as Record<string, unknown>
      this.emit('run:success', { outputs })
      return outputs
    }
    catch (error: any) {
      if (sequence !== this._runSequence || error?.name === 'CanceledError' || error?.name === 'AbortError') {
        return this.getOutputs() as Record<string, unknown>
      }
      const updatedAt = new Date().toISOString()
      if (!this._derivedErrorActive) {
        this.setContext({ status: 'error', updatedAt })
        this.emit('run:error', error)
      }
      throw error
    }
  }

  public override pause(): void {
    this._runSequence += 1
    this._abortController?.abort()
    super.pause()
  }

  public override stop(): void {
    this._runSequence += 1
    this._abortController?.abort()
    super.stop()
  }

  public override async reconcile(): Promise<void> {
    await this.run()
  }

  public override quiesce(): void {
    this._runSequence += 1
    this._abortController?.abort()
    super.quiesce()
  }

  public override destroy(): void {
    this.quiesce()
    this._abortController = null
    this._contextOff?.()
    this._contextOff = null
    for (const dispose of this._outputWatchers) {
      dispose()
    }
    this._outputWatchers = []
    for (const handle of [...this._derivedHandles].reverse()) {
      handle.dispose()
    }
    this._derivedHandles = []
    this._outputPaths.clear()
    this._outputDependents.clear()
    this._responseInputPaths.clear()
    this._outputs = {}
    this._props = {}
    this._outputGeneration = 0
    this._derivedErrorActive = false
    if (Raph.get(this._internalBase) !== undefined) {
      Raph.delete(this._internalBase)
    }
    for (const runtimeId of this._filterChildIds) {
      Endge.runtime.destroyRuntimeTree(runtimeId)
    }
    this._filterChildIds.clear()
    super.destroy()
  }

  protected override onUpdate(ctx: RuntimeHostUpdateContext): void {
    const shouldRun = ctx.updates?.some(update => update.kind === 'run') ?? false
    if (shouldRun) {
      void this.run().catch(() => undefined)
    }
    this.emit('update', ctx)
  }

  /** Монтирует compiled output graph как runtime-scoped Raph materialized dependencies. */
  private _mountOutputGraph(artifact: ProgramArtifact<QueryProgramPayload>): void {
    const payload = artifact.payload
    for (const output of payload.outputs) {
      this._outputPaths.set(output.key, this._resolveOutputPath(output))
    }
    for (const output of payload.outputs) {
      if (output.source.type === 'output') {
        const dependents = this._outputDependents.get(output.source.key) ?? new Set<string>()
        dependents.add(output.key)
        this._outputDependents.set(output.source.key, dependents)
      }
    }

    for (const output of payload.outputs) {
      if (output.materialization.kind === 'source') {
        continue
      }
      const from = output.source.type === 'response'
        ? `${this._internalBase}.inputs.${encodePathPart(output.key)}`
        : this._requireOutputPath(output.source.key)
      if (output.source.type === 'response') {
        this._responseInputPaths.set(output.key, from)
      }
      const to = this._requireOutputPath(output.key)
      const strategy = output.materialization.strategy.kind === 'collection-by-key'
        ? collectionByKey(output.materialization.strategy.key)
        : output.materialization.strategy.kind === 'filter-by-key'
          ? filterByKey(output.materialization.strategy.key)
          : full()
      try {
        const handle = Raph.derive({
          id: `${this.id}:${output.key}`,
          from,
          to,
          strategy,
          immediate: false,
          disposeTarget: 'delete',
          compute: source => runResponseOutputTransforms(output.transforms, output.dataViews, source, artifact.children ?? []),
        })
        this.node?.addChild(handle.node, { invalidate: false })
        this._derivedHandles.push(handle)
        this.addResource({
          id: `derived:${handle.id}`,
          kind: 'raph-node',
          title: `Derived ${output.key}`,
          subtitle: `${from} - ${to}`,
          payload: { output: output.key, from, to, strategy: output.materialization.strategy.kind },
        })
      }
      catch (cause) {
        throw new Error(`[QueryRuntimeHost] Cannot materialize output "${output.key}" at "${to}".`, { cause })
      }
    }

    const masks = [
      `${this._internalBase}.outputs.*`,
      `${this._internalBase}.outputGeneration`,
    ]
    this._outputWatchers.push(Raph.watch(masks, ({ events }) => this._syncOutputs(events, true)))
    this._syncOutputs([], false)
  }

  private _resolveOutputPath(output: QueryProgramPayload['outputs'][number]): string {
    return `${this._internalBase}.outputs.${encodePathPart(output.key)}`
  }

  private _requireOutputPath(key: string): string {
    const path = this._outputPaths.get(key)
    if (!path) {
      throw new Error(`[QueryRuntimeHost] Output path is missing for "${key}".`)
    }
    return path
  }

  private _requireResponseInputPath(key: string): string {
    const path = this._responseInputPaths.get(key)
    if (!path) {
      throw new Error(`[QueryRuntimeHost] Response input path is missing for "${key}".`)
    }
    return path
  }

  private _syncOutputs(events: PhaseEvent[], emit: boolean): void {
    const outputs = Object.fromEntries([...this._outputPaths].map(([key, path]) => [key, Raph.get(path)]))
    this._outputs = outputs
    const derivedError = this._derivedHandles.find(handle => handle.status === 'error')?.lastError ?? null
    if (derivedError && !this._derivedErrorActive) {
      this._derivedErrorActive = true
      this.setContext({ status: 'error', updatedAt: new Date().toISOString() })
      this.emit('run:error', derivedError)
    }
    else if (!derivedError && this._derivedErrorActive) {
      this._derivedErrorActive = false
      this.setContext({ status: 'success', updatedAt: new Date().toISOString() })
    }
    if (!emit) {
      return
    }
    const generationPath = `${this._internalBase}.outputGeneration`
    const isNewGeneration = events.some(event => event.canonical === generationPath)
    const directKeys = isNewGeneration
      ? [...this._outputPaths.keys()]
      : [...this._outputPaths].filter(([, path]) =>
          events.some(event => pathAffects(path, event.canonical)),
        ).map(([key]) => key)
    this._publishOutputs(this._expandDependentOutputKeys(directKeys))
  }

  private _expandDependentOutputKeys(keys: string[]): string[] {
    const expanded = new Set(keys)
    const queue = [...keys]
    while (queue.length) {
      const source = queue.shift()!
      for (const dependent of this._outputDependents.get(source) ?? []) {
        if (expanded.has(dependent)) {
          continue
        }
        expanded.add(dependent)
        queue.push(dependent)
      }
    }
    return [...expanded]
  }

  private _publishOutputs(changedKeys: string[]): void {
    if (!changedKeys.length) {
      return
    }
    for (const key of new Set(changedKeys)) {
      this.emit('output:change', { key, output: this._outputs[key] })
    }
    this.emit('outputs:change', this._outputs)
  }

  private _literalDefaults(payload: QueryProgramPayload): Record<string, unknown> {
    const defaults: Record<string, unknown> = {}
    for (const prop of payload.props) {
      if (prop.defaultValue) {
        defaults[prop.key] = evaluateSourceExpression(prop.defaultValue)
      }
    }
    return defaults
  }

  private _applyProps(patch: Record<string, unknown>, _initial: boolean): void {
    const payload = this.getArtifactPayload()
    const definitions = new Map((payload?.props ?? []).map(prop => [prop.key, prop]))
    for (const [key, value] of Object.entries(patch)) {
      if (!definitions.has(key)) {
        throw new Error(`[QueryRuntimeHost] unknown prop: ${key}`)
      }
      this._props[key] = value
      this.bindInput(key, { kind: 'literal', value })
    }
  }
}

function pathAffects(sourcePath: string, eventPath: string): boolean {
  return eventPath === sourcePath
    || eventPath.startsWith(`${sourcePath}.`)
    || eventPath.startsWith(`${sourcePath}[`)
    || sourcePath.startsWith(`${eventPath}.`)
    || sourcePath.startsWith(`${eventPath}[`)
}

function encodePathPart(value: string): string {
  return encodeURIComponent(String(value)).replace(/\./g, '%2E')
}

function findChildFilterArtifact(
  children: ProgramArtifact[],
  ref: { id: string | number, identity: string },
): ProgramArtifact<FilterProgramPayload> | null {
  return children.find(child =>
    child.ref.entityType === 'filter'
    && (child.ref.id === ref.id || child.ref.identity === ref.identity),
  ) as ProgramArtifact<FilterProgramPayload> | undefined ?? null
}
