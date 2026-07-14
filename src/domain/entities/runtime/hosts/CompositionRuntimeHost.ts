import type { RComposition } from '@/domain/entities/reflect/RComposition'
import type { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import type { FilterViewRuntimeHost } from '@/domain/entities/runtime/hosts/FilterViewRuntimeHost'
import type { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import type { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import type { StoreRuntimeHost } from '@/domain/entities/runtime/hosts/StoreRuntimeHost'
import type {
  CompositionBindingValue,
  CompositionFilterFieldsSlice,
  CompositionProgramPayload,
  CompositionRuntimeChildHandle,
  CompositionRuntimeOutputHandle,
  CompositionRuntimePublicationConnection,
} from '@/domain/types/composition-source.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext, RuntimeHostInputSource, RuntimeHostUpdateContext } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { FilterViewRuntimeHost as EndgeFilterViewRuntimeHost } from '@/domain/entities/runtime/hosts/FilterViewRuntimeHost'
import { Endge } from '@/model/endge/endge'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

function defaultContext(): RuntimeHostContext<'composition'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    mountedChildren: 0,
    lastHookAt: null,
  }
}

/** Runtime orchestration host: children, bindings, hooks и public handles. */
export class CompositionRuntimeHost extends RuntimeHostBase<'composition', RuntimeHostContext<'composition'>, CompositionProgramPayload> {
  private _children = new Map<string, RuntimeHost<any, any>>()
  private _childDescriptors = new Map<string, CompositionProgramPayload['runtimes'][number]>()
  private _outputs: Record<string, CompositionRuntimeOutputHandle> = {}
  private _disposers: Array<() => void> = []
  private _bridgePaths = new Set<string>()
  private _dataPaths = new Map<string, string>()
  private _storeRuntimeIds = new Map<string, string>()
  private _ownedStoreRuntimeIds = new Set<string>()
  private _mounted = false

  public constructor(input: {
    id: string
    model: RComposition
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
    artifactReader: RuntimeArtifactReader
  }) {
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      kind: 'composition',
      runtimeType: 'composition-runtime-host',
      entityType: 'composition',
      entityIdentity: input.model.identity ?? String(input.model.id),
      title: input.model.displayName ?? input.model.name ?? input.model.identity,
      context: defaultContext(),
      artifactReader: input.artifactReader,
      artifactRef: { entityType: 'composition', id: input.model.id, identity: input.model.identity },
    })
  }

  public static createRuntime(input: {
    id: string
    model: RComposition
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifacts: RuntimeArtifactReader
  }): CompositionRuntimeHost | null {
    const artifact = input.artifacts.getArtifact<CompositionProgramPayload>('composition', input.model.id ?? input.model.identity)
    if (!artifact || artifact.status === 'error')
      return null

    const host = new CompositionRuntimeHost({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: input.meta,
      artifactReader: input.artifacts,
    })
    const node = new RaphNode(Raph.app, {
      id: `${input.model.identity}-${input.id}`,
      meta: { type: 'composition', runtimeId: input.id, entityIdentity: input.model.identity },
    })
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({ id: `node:${node.id}`, kind: 'raph-node', title: node.id })
    host.create()
    return host
  }

  /** Создает children, bindings и hooks. Повторный mount является no-op. */
  public async mountGraph(): Promise<void> {
    if (this._mounted)
      return
    const payload = this.getArtifactPayload()
    if (!payload)
      throw new Error(`[CompositionRuntimeHost] artifact is missing for "${this.entityIdentity}".`)

    try {
      this._mountData(payload)
      const orderedRuntimes = this._dependencyOrder(payload.runtimes)
      for (const descriptor of orderedRuntimes)
        await this._createChild(descriptor)
      for (const descriptor of orderedRuntimes)
        this._bindChild(descriptor)
      this._makeOutputs(payload)
      this._bindHooks(payload)
      this._mounted = true
      const now = new Date().toISOString()
      this.setContext({ status: 'success', startedAt: now, updatedAt: now, mountedChildren: this._children.size })

      for (const mount of payload.graph.mounts)
        await this._runQuery(mount.targetRuntime)
    }
    catch (error) {
      this.destroy()
      throw error
    }
  }

  public getChild(name: string): RuntimeHost<any, any> | null {
    return this._children.get(String(name ?? '').trim()) ?? null
  }

  public getChildren(): CompositionRuntimeChildHandle[] {
    return Array.from(this._children.entries()).map(([name, runtime]) => {
      const descriptor = this._childDescriptors.get(name)
      if (!descriptor)
        throw new Error(`[CompositionRuntimeHost] descriptor "${name}" is missing.`)
      return { name, descriptor, runtime }
    })
  }

  public getFilterFieldsSlice(runtimeName: string, fieldKeys: string[]): CompositionFilterFieldsSlice | null {
    return this._readFilterFieldsBinding({
      kind: 'filter-fields',
      runtime: runtimeName,
      fields: fieldKeys,
    })
  }

  public getOutputs(): Readonly<Record<string, CompositionRuntimeOutputHandle>> {
    return { ...this._outputs }
  }

  /** Возвращает текущее значение публичного Composition output. */
  public getOutput(name: string): unknown {
    const key = String(name ?? '').trim()
    const handle = this._outputs[key]
    if (!handle)
      return undefined
    return handle.output ? Raph.get(this.outputPath(key)) : handle.runtime
  }

  /** Текущие значения data-блока для preview и runtime debugger. */
  public getDataSnapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
      Array.from(this._dataPaths.entries()).map(([name, path]) => [name, Raph.get(path)]),
    )
  }

  /** Возвращает runtime Raph path объявленной data-зависимости. */
  public getDataPath(name: string, path = ''): string {
    return this._requireDataPath(name, path)
  }

  public override destroy(): void {
    for (const dispose of this._disposers)
      dispose()
    this._disposers = []
    for (const path of this._bridgePaths)
      Raph.delete(path)
    this._bridgePaths.clear()
    for (const runtimeId of this._ownedStoreRuntimeIds) {
      if (Endge.runtime.getRuntimeById(runtimeId))
        Endge.runtime.destroyRuntimeTree(runtimeId)
    }
    this._ownedStoreRuntimeIds.clear()
    for (const child of this._children.values()) {
      if (Endge.runtime.getRuntimeById(child.id))
        Endge.runtime.destroyRuntimeTree(child.id)
      else if (child.status !== 'destroyed')
        child.destroy()
    }
    this._children.clear()
    this._childDescriptors.clear()
    this._outputs = {}
    this._dataPaths.clear()
    this._storeRuntimeIds.clear()
    this._mounted = false
    super.destroy()
  }

  /** Монтирует vocab data и связывает Store aliases с owned/borrowed runtime instances. */
  private _mountData(payload: CompositionProgramPayload): void {
    const explicitStoreRuntimes = (
      this.meta.dataRuntimes && typeof this.meta.dataRuntimes === 'object'
        ? this.meta.dataRuntimes
        : {}
    ) as Record<string, unknown>

    for (const descriptor of payload.data) {
      const basePath = `__endge.compositionRuntime.${encodePathPart(this.id)}.data.${encodePathPart(descriptor.name)}`

      if (descriptor.kind === 'vocab') {
        const vocab = Endge.domain.getVocab(descriptor.identity)
        if (!vocab)
          throw new Error(`[CompositionRuntimeHost] Vocab data "${descriptor.identity}" is missing.`)
        this._dataPaths.set(descriptor.name, basePath)
        this._bridgePaths.add(basePath)
        Raph.set(basePath, vocab)
        this.addResource({
          id: `data:${descriptor.name}`,
          kind: 'raph-node',
          title: `Data ${descriptor.name}`,
          subtitle: descriptor.identity,
          payload: { path: basePath, kind: descriptor.kind, identity: descriptor.identity, ownership: 'owned' },
        })
        continue
      }

      const store = Endge.domain.getStore(descriptor.identity)
      if (!store)
        throw new Error(`[CompositionRuntimeHost] Store data "${descriptor.identity}" is missing.`)
      const explicitRuntimeId = String(explicitStoreRuntimes[descriptor.name] ?? '').trim()
      let storeRuntime: StoreRuntimeHost | null = null
      let ownership: 'owned' | 'borrowed' = 'owned'
      if (explicitRuntimeId) {
        storeRuntime = Endge.runtime.getRuntimeById<StoreRuntimeHost>(explicitRuntimeId)
        ownership = 'borrowed'
        if (!storeRuntime || storeRuntime.entityType !== 'store')
          throw new Error(`[CompositionRuntimeHost] Store runtime "${explicitRuntimeId}" for data alias "${descriptor.name}" is missing.`)
        if (storeRuntime.entityIdentity !== descriptor.identity)
          throw new Error(`[CompositionRuntimeHost] Store runtime "${explicitRuntimeId}" has identity "${storeRuntime.entityIdentity}" instead of "${descriptor.identity}".`)
      }
      else {
        storeRuntime = Endge.runtime.execute(store, {
          id: `${this.id}:data:${descriptor.name}`,
          parent: this,
          instance: descriptor.name,
          persistence: 'disabled',
        }) as StoreRuntimeHost | null
        if (!storeRuntime)
          throw new Error(`[CompositionRuntimeHost] Store runtime for "${descriptor.identity}" cannot be created.`)
        this._ownedStoreRuntimeIds.add(storeRuntime.id)
      }

      const storePath = storeRuntime.getDataPath()
      this._dataPaths.set(descriptor.name, storePath)
      this._storeRuntimeIds.set(descriptor.name, storeRuntime.id)
      this.addResource({
        id: `data:${descriptor.name}`,
        kind: 'meta',
        title: `Store ${descriptor.name}`,
        subtitle: descriptor.identity,
        payload: {
          path: storePath,
          kind: descriptor.kind,
          identity: descriptor.identity,
          runtimeId: storeRuntime.id,
          ownership,
        },
      })
    }
  }

  /** Атомарно публикует накопленный batch runtime outputs в writable Store data. */
  private _publishUpdates(publications: CompositionRuntimePublicationConnection[]): void {
    const writes: Array<{ runtimeId: string, path: string, value: unknown }> = []
    for (const publication of publications) {
      const runtimeId = this._storeRuntimeIds.get(publication.targetData)
      const storeRuntime = runtimeId
        ? Endge.runtime.getRuntimeById<StoreRuntimeHost>(runtimeId)
        : null
      if (!storeRuntime || storeRuntime.entityType !== 'store')
        throw new Error(`[CompositionRuntimeHost] Store data "${publication.targetData}" is not mounted.`)
      if (!storeRuntime.isWritable(publication.targetPath))
        throw new Error(`[CompositionRuntimeHost] Store target "${publication.targetData}.${publication.targetPath}" is derived or missing.`)
      const source = this._children.get(publication.sourceRuntime)
      if (!source)
        throw new Error(`[CompositionRuntimeHost] Runtime "${publication.sourceRuntime}" is missing.`)
      writes.push({
        runtimeId: storeRuntime.id,
        path: publication.targetPath,
        value: Raph.get(source.outputPath(publication.sourceOutput)),
      })
    }

    Raph.transaction(() => {
      for (const write of writes) {
        const storeRuntime = Endge.runtime.getRuntimeById<StoreRuntimeHost>(write.runtimeId)
        if (!storeRuntime)
          throw new Error(`[CompositionRuntimeHost] Store runtime "${write.runtimeId}" was replaced or removed.`)
        storeRuntime.set(write.path, write.value)
      }
    })
    this.emit('data:change', this.getDataSnapshot())
  }

  protected override onUpdate(ctx: RuntimeHostUpdateContext): void {
    const publications = (ctx.updates ?? [])
      .filter(update => update.kind === 'publish')
      .map(update => update.payload as CompositionRuntimePublicationConnection)
    if (publications.length)
      this._publishUpdates(publications)
    this.emit('update', ctx)
  }

  private _requireDataPath(name: string, path = ''): string {
    const basePath = this._dataPaths.get(name)
    if (!basePath)
      throw new Error(`[CompositionRuntimeHost] Data alias "${name}" is missing.`)
    return path ? `${basePath}.${path.split('.').map(encodePathPart).join('.')}` : basePath
  }

  private async _createChild(descriptor: CompositionProgramPayload['runtimes'][number]): Promise<void> {
    if (descriptor.kind === 'filter-view') {
      const source = this._children.get(descriptor.identity) as FilterRuntimeHost | undefined
      if (!source || source.entityType !== 'filter' || source.runtimeType !== 'filter-runtime-host')
        throw new Error(`[CompositionRuntimeHost] filterView source runtime "${descriptor.identity}" is missing.`)
      const initialProps = Object.fromEntries(
        Object.entries(this._compiledInputs(descriptor.name))
          .map(([key, binding]) => [key, this._readBinding(binding)]),
      )
      const child = new EndgeFilterViewRuntimeHost({
        id: `${this.id}:${descriptor.name}`,
        name: descriptor.name,
        model: source.model as any,
        sourceRuntimeName: descriptor.identity,
        sourceRuntime: source,
        fieldKeys: descriptor.fields,
        controls: descriptor.controls,
        componentIdentity: descriptor.componentIdentity,
        props: initialProps,
        parent: this,
        meta: {
          instance: descriptor.name,
          sourceRuntime: descriptor.identity,
        },
      })
      const node = new RaphNode(Raph.app, {
        id: `${this.id}:${descriptor.name}:root`,
        meta: { type: 'runtime-node', kind: 'root', runtimeId: child.id },
      })
      Raph.app.addNode(node)
      child.addRaphNode(node)
      child.create()
      if (!Endge.runtime.registerRuntimeHost(child)) {
        child.destroy()
        throw new Error(`[CompositionRuntimeHost] filterView runtime "${descriptor.name}" cannot be registered.`)
      }
      this._children.set(descriptor.name, child)
      this._childDescriptors.set(descriptor.name, descriptor)
      return
    }

    let model: any = null
    if (descriptor.kind === 'filter')
      model = Endge.domain.getFilter(descriptor.identity)
    else if (descriptor.kind === 'query')
      model = Endge.domain.getQuery(descriptor.identity)
    else if (descriptor.kind === 'composition')
      model = Endge.domain.getComposition(descriptor.identity)
    else
      model = Endge.domain.getComponentSFC(descriptor.identity) ?? Endge.domain.getComponent(descriptor.identity)
    if (!model)
      throw new Error(`[CompositionRuntimeHost] model "${descriptor.identity}" is missing.`)

    if (descriptor.kind === 'composition')
      this._assertCompositionCycle(descriptor.identity)

    const initialProps = Object.fromEntries(
      Object.entries(this._compiledInputs(descriptor.name))
        .map(([key, binding]) => [key, this._readBinding(binding)]),
    )
    const basePath = `compositions.${this.id}.children.${descriptor.name}.props`
    const meta: Record<string, unknown> = {
      id: `${this.id}:${descriptor.name}`,
      parent: this,
      instance: descriptor.name,
      props: initialProps,
      persistence: descriptor.persistKey ? 'local' : 'disabled',
      persistenceKey: descriptor.persistKey,
      basePath,
      input: { kind: 'local', props: initialProps },
    }
    if (descriptor.kind === 'component') {
      Raph.set(basePath, initialProps)
      this._bridgePaths.add(basePath)
    }

    const child = Endge.runtime.execute(model, meta)
    if (!child)
      throw new Error(`[CompositionRuntimeHost] runtime "${descriptor.name}" cannot be created.`)
    this._children.set(descriptor.name, child)
    this._childDescriptors.set(descriptor.name, descriptor)
    if (descriptor.kind === 'composition')
      await (child as unknown as CompositionRuntimeHost).mountGraph()
  }

  private _bindChild(descriptor: CompositionProgramPayload['runtimes'][number]): void {
    const child = this._children.get(descriptor.name)
    if (!child)
      return
    const inputBindings = this._compiledInputs(descriptor.name)

    if (descriptor.kind === 'filter-view') {
      const filterView = child as unknown as FilterViewRuntimeHost
      for (const [prop, binding] of Object.entries(inputBindings)) {
        if (binding.kind === 'literal')
          continue
        const sync = () => filterView.setProps({ [prop]: this._readBinding(binding) })
        sync()
        this._subscribeBinding(binding, sync)
      }
      return
    }

    if (descriptor.kind === 'query') {
      const query = child as unknown as QueryRuntimeHost
      for (const [prop, binding] of Object.entries(inputBindings)) {
        if (binding.kind === 'literal') {
          query.bindInput(prop, { kind: 'literal', value: binding.value })
          continue
        }
        query.bindInput(prop, {
          kind: 'raph',
          path: this._bindingPath(descriptor.name, prop, binding),
        })
      }
      return
    }

    if (descriptor.kind !== 'component')
      return
    const modelType = String((child.model as any)?.type ?? '')
    if (modelType === 'component-sfc') {
      const literals: Record<string, unknown> = {}
      const bindings: Record<string, { path: string }> = {}
      for (const [prop, binding] of Object.entries(inputBindings)) {
        if (binding.kind === 'literal') {
          literals[prop] = binding.value
          continue
        }
        const path = binding.kind === 'store'
          ? binding.key
          : binding.kind === 'data'
            ? this._requireDataPath(binding.data, binding.path)
          : this._materializeBinding(descriptor.name, prop, binding)
        bindings[prop] = { path }
      }
      const input: RuntimeHostInputSource = Object.keys(bindings).length
        ? { kind: 'raph', bindings, props: literals }
        : { kind: 'local', props: literals }
      ;(child as unknown as ComponentSFCRuntimeHost).setInputSource(input)
      return
    }

    const basePath = String(child.meta.basePath ?? '')
    const syncLegacy = () => {
      const props = Object.fromEntries(Object.entries(inputBindings).map(([key, binding]) => [key, this._readBinding(binding)]))
      Raph.set(basePath, props)
    }
    syncLegacy()
    for (const binding of Object.values(inputBindings))
      this._subscribeBinding(binding, syncLegacy)
  }

  private _makeOutputs(payload: CompositionProgramPayload): void {
    this._outputs = Object.fromEntries(payload.outputs.map(output => {
      const runtime = this._children.get(output.runtime)
      if (!runtime)
        throw new Error(`[CompositionRuntimeHost] output runtime "${output.runtime}" is missing.`)
      if (output.output) {
        const sourcePath = runtime.outputPath(output.output)
        const targetPath = this.outputPath(output.key)
        const sync = () => Raph.set(targetPath, Raph.get(sourcePath))
        sync()
        this._disposers.push(Raph.watch([sourcePath, `${sourcePath}.*`], sync))
      }
      return [output.key, { runtime, output: output.output }]
    }))
  }

  /** Не допускает прямые и транзитивные циклы Composition runtime tree. */
  private _assertCompositionCycle(identity: string): void {
    let current: RuntimeHost<any, any> | null = this
    while (current) {
      if (current.entityType === 'composition' && current.entityIdentity === identity) {
        throw new Error(`[CompositionRuntimeHost] composition cycle detected for "${identity}".`)
      }
      current = current.parent
    }
  }

  private _bindHooks(payload: CompositionProgramPayload): void {
    for (const connection of payload.graph.updates) {
      const source = this._children.get(connection.sourceRuntime)
      const target = this._children.get(connection.targetRuntime)
      if (!source || !target)
        continue
      this._disposers.push(target.bindUpdate({
        id: connection.id,
        sourcePath: source.outputPath(connection.sourceOutput),
        update: { kind: connection.updateKind },
        policy: { debounceMs: connection.debounceMs, distinct: 'structural' },
      }))
    }

    for (const publication of payload.graph.publications) {
      const source = this._children.get(publication.sourceRuntime)
      if (!source)
        continue
      this._disposers.push(this.bindUpdate({
        id: publication.id,
        sourcePath: source.outputPath(publication.sourceOutput),
        update: { kind: 'publish', payload: publication },
        policy: { distinct: 'structural' },
      }))
    }

    const initialPublications = payload.graph.publications.filter(publication => {
      const source = this._children.get(publication.sourceRuntime)
      return source && Raph.get(source.outputPath(publication.sourceOutput)) !== undefined
    })
    if (initialPublications.length)
      this._publishUpdates(initialPublications)
  }

  private async _runQuery(name: string): Promise<void> {
    const query = this._children.get(name) as unknown as QueryRuntimeHost | undefined
    if (!query || typeof query.run !== 'function')
      throw new Error(`[CompositionRuntimeHost] Query runtime "${name}" is missing.`)
    await query.run()
    const now = new Date().toISOString()
    this.setContext({ updatedAt: now, lastHookAt: now })
  }

  private _readBinding(binding: CompositionBindingValue): unknown {
    if (binding.kind === 'literal')
      return binding.value
    if (binding.kind === 'store')
      return Raph.get(binding.key)
    if (binding.kind === 'data')
      return Raph.get(this._requireDataPath(binding.data, binding.path))
    if (binding.kind === 'filter-fields')
      return this._readFilterFieldsBinding(binding)
    if (binding.kind === 'expression') {
      return evaluateSourceExpression(binding.expression, {
        read: expression => this._readExpressionSource(expression),
      })
    }
    const runtime = this._children.get(binding.runtime) as any
    const output = runtime?.getOutput?.(binding.output)
    return output?.kind === 'json' ? output.value : output
  }

  private _compiledInputs(runtimeName: string): Record<string, CompositionBindingValue> {
    const graph = this.getArtifactPayload()?.graph
    if (!graph)
      return {}
    return Object.fromEntries(
      graph.inputs
        .filter(connection => connection.targetRuntime === runtimeName)
        .map(connection => [connection.targetProp, connection.source]),
    )
  }

  private _subscribeBinding(binding: CompositionBindingValue, sync: () => void): void {
    if (binding.kind === 'literal')
      return
    if (binding.kind === 'store') {
      const dispose = Raph.watch(binding.key, sync)
      this._disposers.push(dispose)
      return
    }
    if (binding.kind === 'data') {
      const dispose = Raph.watch(`${this._requireDataPath(binding.data, binding.path)}.*`, sync)
      this._disposers.push(dispose)
      return
    }
    if (binding.kind === 'filter-fields') {
      const runtime = this._children.get(binding.runtime)
      if (!runtime)
        return
      this._disposers.push(Raph.watch([
        runtime.statePath(),
        `${runtime.statePath()}.*`,
      ], sync))
      return
    }
    if (binding.kind === 'expression') {
      const seen = new Set<string>()
      for (const read of this._collectExpressionReads(binding.expression)) {
        const key = `${read.source}:${read.path}:${JSON.stringify(read.parameters ?? [])}`
        if (seen.has(key))
          continue
        seen.add(key)
        this._subscribeExpressionRead(read, sync)
      }
      return
    }
    const runtime = this._children.get(binding.runtime)
    if (!runtime)
      return
    this._disposers.push(Raph.watch([
      runtime.outputPath(binding.output),
      `${runtime.outputPath(binding.output)}.*`,
    ], sync))
  }

  private _bindingPath(
    runtimeName: string,
    prop: string,
    binding: Exclude<CompositionBindingValue, { kind: 'literal' }>,
  ): string {
    if (binding.kind === 'store')
      return binding.key
    if (binding.kind === 'data')
      return this._requireDataPath(binding.data, binding.path)
    if (binding.kind === 'output') {
      const source = this._children.get(binding.runtime)
      if (!source)
        throw new Error(`[CompositionRuntimeHost] Binding runtime "${binding.runtime}" is missing.`)
      return source.outputPath(binding.output)
    }
    return this._materializeBinding(runtimeName, prop, binding)
  }

  private _materializeBinding(
    runtimeName: string,
    prop: string,
    binding: Extract<CompositionBindingValue, { kind: 'output' | 'filter-fields' | 'data' | 'expression' }>,
  ): string {
    const path = `compositions.${this.id}.bindings.${runtimeName}.${prop}`
    const sync = () => Raph.set(path, this._readBinding(binding))
    sync()
    this._subscribeBinding(binding, sync)
    this._bridgePaths.add(path)
    return path
  }

  private _readExpressionSource(
    read: Extract<import('@/domain/types/source-expression.types').SourceExpressionIR, { type: 'read' }>,
  ): unknown {
    const parameters = read.parameters ?? []
    if (read.source === 'composition-output') {
      const runtime = this._children.get(parameters[0]) as any
      const output = runtime?.getOutput?.(parameters[1])
      return output?.kind === 'json' ? output.value : output
    }
    if (read.source === 'composition-store')
      return Raph.get(parameters[0])
    if (read.source === 'composition-data') {
      const ref = parameters[0] ?? ''
      const dot = ref.indexOf('.')
      return Raph.get(this._requireDataPath(dot > 0 ? ref.slice(0, dot) : ref, dot > 0 ? ref.slice(dot + 1) : ''))
    }
    if (read.source === 'composition-filter-fields') {
      return this._readFilterFieldsBinding({
        kind: 'filter-fields',
        runtime: parameters[0],
        fields: parameters.slice(1),
      })
    }
    if (read.source === 'metadata')
      return Endge.program.getArtifact(parameters[0] as any, parameters[1])?.metadata
    if (read.source === 'store')
      return Raph.get(read.path)
    return undefined
  }

  private _collectExpressionReads(
    expression: import('@/domain/types/source-expression.types').SourceExpressionIR,
  ): Array<Extract<import('@/domain/types/source-expression.types').SourceExpressionIR, { type: 'read' }>> {
    if (expression.type === 'read')
      return [expression]
    if (expression.type === 'operation')
      return expression.arguments.flatMap(argument => this._collectExpressionReads(argument))
    if (expression.type === 'array')
      return expression.items.flatMap(argument => this._collectExpressionReads(argument))
    if (expression.type === 'object')
      return Object.values(expression.properties).flatMap(argument => this._collectExpressionReads(argument))
    return []
  }

  private _subscribeExpressionRead(
    read: Extract<import('@/domain/types/source-expression.types').SourceExpressionIR, { type: 'read' }>,
    sync: () => void,
  ): void {
    const parameters = read.parameters ?? []
    if (read.source === 'metadata' || read.source === 'current')
      return
    if (read.source === 'composition-output') {
      const runtime = this._children.get(parameters[0])
      if (runtime)
        this._disposers.push(Raph.watch([runtime.outputPath(parameters[1]), `${runtime.outputPath(parameters[1])}.*`], sync))
      return
    }
    if (read.source === 'composition-filter-fields') {
      const runtime = this._children.get(parameters[0])
      if (runtime)
        this._disposers.push(Raph.watch([runtime.statePath(), `${runtime.statePath()}.*`], sync))
      return
    }
    if (read.source === 'composition-store' || read.source === 'store') {
      this._disposers.push(Raph.watch(read.source === 'store' ? read.path : parameters[0], sync))
      return
    }
    if (read.source === 'composition-data') {
      const ref = parameters[0] ?? ''
      const dot = ref.indexOf('.')
      const path = this._requireDataPath(dot > 0 ? ref.slice(0, dot) : ref, dot > 0 ? ref.slice(dot + 1) : '')
      this._disposers.push(Raph.watch(`${path}.*`, sync))
    }
  }

  private _readFilterFieldsBinding(binding: Extract<CompositionBindingValue, { kind: 'filter-fields' }>): CompositionFilterFieldsSlice | null {
    const runtime = this._children.get(binding.runtime) as FilterRuntimeHost | undefined
    if (!runtime || typeof runtime.getFields !== 'function' || typeof runtime.getState !== 'function')
      return null

    const fields = runtime.getFields()
      .filter(field => binding.fields.includes(field.key))
    const state = runtime.getState()
    return {
      kind: 'filter-fields',
      runtimeId: runtime.id,
      runtimeName: binding.runtime,
      fieldKeys: binding.fields,
      fields,
      values: Object.fromEntries(binding.fields.map(key => [key, state[key]])),
    }
  }

  public isFilterViewRuntime(runtime: RuntimeHost<any, any>): runtime is FilterViewRuntimeHost {
    return runtime.runtimeType === 'filter-view-runtime-host'
  }

  /** Возвращает topological runtime order по fromOutput dependencies. */
  private _dependencyOrder(
    runtimes: CompositionProgramPayload['runtimes'],
  ): CompositionProgramPayload['runtimes'] {
    const byName = new Map(runtimes.map(runtime => [runtime.name, runtime]))
    const visited = new Set<string>()
    const visiting = new Set<string>()
    const ordered: CompositionProgramPayload['runtimes'] = []

    const visit = (name: string) => {
      if (visited.has(name))
        return
      if (visiting.has(name))
        throw new Error(`[CompositionRuntimeHost] runtime dependency cycle near "${name}".`)
      const runtime = byName.get(name)
      if (!runtime)
        throw new Error(`[CompositionRuntimeHost] runtime dependency "${name}" is missing.`)
      visiting.add(name)
      if (runtime.kind === 'filter-view')
        visit(runtime.identity)
      for (const binding of Object.values(this._compiledInputs(runtime.name))) {
        if (binding.kind === 'output' || binding.kind === 'filter-fields')
          visit(binding.runtime)
        else if (binding.kind === 'expression') {
          for (const read of this._collectExpressionReads(binding.expression)) {
            if (read.source === 'composition-output' || read.source === 'composition-filter-fields')
              visit(read.parameters?.[0] ?? '')
          }
        }
      }
      visiting.delete(name)
      visited.add(name)
      ordered.push(runtime)
    }

    for (const runtime of runtimes)
      visit(runtime.name)
    return ordered
  }
}

function encodePathPart(value: string): string {
  return encodeURIComponent(String(value)).replace(/\./g, '%2E')
}
