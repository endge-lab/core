import type { RComposition } from '@/domain/entities/reflect/RComposition'
import type { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import type { FilterFieldsRuntimeHost } from '@/domain/entities/runtime/hosts/FilterFieldsRuntimeHost'
import type { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import type { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import type {
  CompositionBindingValue,
  CompositionFilterFieldsSlice,
  CompositionProgramPayload,
  CompositionRuntimeChildHandle,
  CompositionRuntimeOutputHandle,
} from '@/domain/types/composition-source.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext, RuntimeHostInputSource } from '@/domain/types/runtime-host.types'

import { Raph, RaphNode } from '@endge/raph'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import { FilterFieldsRuntimeHost as EndgeFilterFieldsRuntimeHost } from '@/domain/entities/runtime/hosts/FilterFieldsRuntimeHost'
import { Endge } from '@/model/endge/endge'

function defaultContext(): RuntimeHostContext<'composition'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    mountedChildren: 0,
    lastReactionAt: null,
  }
}

/** Runtime orchestration host: children, bindings, reactions и public handles. */
export class CompositionRuntimeHost extends RuntimeHostBase<'composition', RuntimeHostContext<'composition'>, CompositionProgramPayload> {
  private _children = new Map<string, RuntimeHost<any, any>>()
  private _childDescriptors = new Map<string, CompositionProgramPayload['runtimes'][number]>()
  private _outputs: Record<string, CompositionRuntimeOutputHandle> = {}
  private _disposers: Array<() => void> = []
  private _timers = new Map<string, ReturnType<typeof setTimeout>>()
  private _bridgePaths = new Set<string>()
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

  /** Создает children, bindings и reactions. Повторный mount является no-op. */
  public async mountGraph(): Promise<void> {
    if (this._mounted)
      return
    const payload = this.getArtifactPayload()
    if (!payload)
      throw new Error(`[CompositionRuntimeHost] artifact is missing for "${this.entityIdentity}".`)

    try {
      const orderedRuntimes = this._dependencyOrder(payload.runtimes)
      for (const descriptor of orderedRuntimes)
        this._createChild(descriptor)
      for (const descriptor of orderedRuntimes)
        this._bindChild(descriptor)
      this._makeOutputs(payload)
      this._bindReactions(payload)
      this._mounted = true
      const now = new Date().toISOString()
      this.setContext({ status: 'success', startedAt: now, updatedAt: now, mountedChildren: this._children.size })

      for (const reaction of payload.reactions) {
        if (reaction.kind === 'mount')
          await this._runQuery(reaction.target)
      }
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

  public override destroy(): void {
    for (const timer of this._timers.values())
      clearTimeout(timer)
    this._timers.clear()
    for (const dispose of this._disposers)
      dispose()
    this._disposers = []
    for (const path of this._bridgePaths)
      Raph.delete(path)
    this._bridgePaths.clear()
    for (const child of this._children.values()) {
      if (Endge.runtime.getRuntimeById(child.id))
        Endge.runtime.destroyRuntimeTree(child.id)
      else
        child.destroy()
    }
    this._children.clear()
    this._childDescriptors.clear()
    this._outputs = {}
    this._mounted = false
    super.destroy()
  }

  private _createChild(descriptor: CompositionProgramPayload['runtimes'][number]): void {
    if (descriptor.kind === 'filter-fields') {
      const source = this._children.get(descriptor.identity) as FilterRuntimeHost | undefined
      if (!source || source.entityType !== 'filter' || source.runtimeType !== 'filter-runtime-host')
        throw new Error(`[CompositionRuntimeHost] filterFields source runtime "${descriptor.identity}" is missing.`)
      const child = new EndgeFilterFieldsRuntimeHost({
        id: `${this.id}:${descriptor.name}:${descriptor.instance}`,
        name: descriptor.name,
        model: source.model as any,
        sourceRuntimeName: descriptor.identity,
        sourceRuntime: source,
        fieldKeys: descriptor.fields ?? [],
        parent: this,
        meta: {
          instance: descriptor.instance,
          sourceRuntime: descriptor.identity,
        },
      })
      child.create()
      this._children.set(descriptor.name, child)
      this._childDescriptors.set(descriptor.name, descriptor)
      return
    }

    let model: any = null
    if (descriptor.kind === 'filter')
      model = Endge.domain.getFilter(descriptor.identity)
    else if (descriptor.kind === 'query')
      model = Endge.domain.getQuery(descriptor.identity)
    else
      model = Endge.domain.getComponentSFC(descriptor.identity) ?? Endge.domain.getComponent(descriptor.identity)
    if (!model)
      throw new Error(`[CompositionRuntimeHost] model "${descriptor.identity}" is missing.`)

    const initialProps = Object.fromEntries(
      Object.entries(descriptor.props)
        .map(([key, binding]) => [key, this._readBinding(binding)]),
    )
    const basePath = `compositions.${this.id}.children.${descriptor.name}.props`
    const meta: Record<string, unknown> = {
      id: `${this.id}:${descriptor.name}:${descriptor.instance}`,
      parent: this,
      instance: descriptor.instance,
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
  }

  private _bindChild(descriptor: CompositionProgramPayload['runtimes'][number]): void {
    const child = this._children.get(descriptor.name)
    if (!child)
      return

    if (descriptor.kind === 'query') {
      const query = child as unknown as QueryRuntimeHost
      for (const [prop, binding] of Object.entries(descriptor.props)) {
        if (binding.kind === 'literal')
          continue
        const sync = () => query.setProps({ [prop]: this._readBinding(binding) })
        sync()
        this._subscribeBinding(binding, sync)
      }
      return
    }

    if (descriptor.kind !== 'component')
      return
    const modelType = String((child.model as any)?.type ?? '')
    if (modelType === 'component-sfc') {
      const literals: Record<string, unknown> = {}
      const bindings: Record<string, { path: string }> = {}
      for (const [prop, binding] of Object.entries(descriptor.props)) {
        if (binding.kind === 'literal') {
          literals[prop] = binding.value
          continue
        }
        const path = binding.kind === 'store'
          ? binding.key
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
      const props = Object.fromEntries(Object.entries(descriptor.props).map(([key, binding]) => [key, this._readBinding(binding)]))
      Raph.set(basePath, props)
    }
    syncLegacy()
    for (const binding of Object.values(descriptor.props))
      this._subscribeBinding(binding, syncLegacy)
  }

  private _makeOutputs(payload: CompositionProgramPayload): void {
    this._outputs = Object.fromEntries(payload.outputs.map(output => {
      const runtime = this._children.get(output.runtime)
      if (!runtime)
        throw new Error(`[CompositionRuntimeHost] output runtime "${output.runtime}" is missing.`)
      return [output.key, { runtime, output: output.output }]
    }))
  }

  private _bindReactions(payload: CompositionProgramPayload): void {
    payload.reactions.forEach((reaction, index) => {
      if (reaction.kind !== 'change')
        return
      const runtime = this._children.get(reaction.runtime)
      if (!runtime)
        return
      const handler = (event: any) => {
        if (event?.key !== reaction.output)
          return
        const timerKey = `${index}:${reaction.runtime}.${reaction.output}`
        const previous = this._timers.get(timerKey)
        if (previous)
          clearTimeout(previous)
        const timer = setTimeout(() => {
          this._timers.delete(timerKey)
          void this._runQuery(reaction.target)
        }, reaction.debounceMs)
        this._timers.set(timerKey, timer)
      }
      runtime.on('output:change', handler)
      this._disposers.push(() => runtime.off('output:change', handler))
    })
  }

  private async _runQuery(name: string): Promise<void> {
    const query = this._children.get(name) as unknown as QueryRuntimeHost | undefined
    if (!query || typeof query.run !== 'function')
      throw new Error(`[CompositionRuntimeHost] Query runtime "${name}" is missing.`)
    await query.run()
    const now = new Date().toISOString()
    this.setContext({ updatedAt: now, lastReactionAt: now })
  }

  private _readBinding(binding: CompositionBindingValue): unknown {
    if (binding.kind === 'literal')
      return binding.value
    if (binding.kind === 'store')
      return Raph.get(binding.key)
    if (binding.kind === 'filter-fields')
      return this._readFilterFieldsBinding(binding)
    const runtime = this._children.get(binding.runtime) as any
    const output = runtime?.getOutput?.(binding.output)
    return output?.kind === 'json' ? output.value : output
  }

  private _subscribeBinding(binding: CompositionBindingValue, sync: () => void): void {
    if (binding.kind === 'literal')
      return
    if (binding.kind === 'store') {
      const dispose = Raph.watch(binding.key, sync)
      this._disposers.push(dispose)
      return
    }
    if (binding.kind === 'filter-fields') {
      const runtime = this._children.get(binding.runtime)
      if (!runtime)
        return
      runtime.on('state:change', sync)
      this._disposers.push(() => {
        runtime.off('state:change', sync)
      })
      return
    }
    const runtime = this._children.get(binding.runtime)
    if (!runtime)
      return
    const handler = (event: any) => {
      if (event?.key === binding.output)
        sync()
    }
    runtime.on('output:change', handler)
    this._disposers.push(() => {
      runtime.off('output:change', handler)
    })
  }

  private _materializeBinding(
    runtimeName: string,
    prop: string,
    binding: Extract<CompositionBindingValue, { kind: 'output' | 'filter-fields' }>,
  ): string {
    const path = `compositions.${this.id}.bindings.${runtimeName}.${prop}`
    const sync = () => Raph.set(path, this._readBinding(binding))
    sync()
    this._subscribeBinding(binding, sync)
    this._bridgePaths.add(path)
    return path
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

  public isFilterFieldsRuntime(runtime: RuntimeHost<any, any>): runtime is FilterFieldsRuntimeHost {
    return runtime.runtimeType === 'filter-fields-runtime-host'
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
      if (runtime.kind === 'filter-fields')
        visit(runtime.identity)
      for (const binding of Object.values(runtime.props)) {
        if (binding.kind === 'output' || binding.kind === 'filter-fields')
          visit(binding.runtime)
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
