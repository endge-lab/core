import type { RaphDerivedHandle } from '@endge/raph'
import type { RComposition } from '@/features/core/modules/domain/entities/RComposition'
import type {
  ComponentSFCEventInputValue,
  ComponentSFCEventOccurrence,
} from '@/features/core/modules/domain/types/component/sfc/ports.types'
import type { I18nRuntimeCatalog } from '@/features/core/modules/i18n/domain/i18n.types'
import type { RuntimeArtifactReader, RuntimeHost, RuntimeHostContext, RuntimeHostInputBinding, RuntimeHostInputSource, RuntimeHostUpdateContext } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { VocabRuntimeCatalog } from '@/features/core/modules/runtime/domain/vocab-cache.types'
import type { ComponentSFCRuntimeHost } from '@/features/core/modules/runtime/hosts/ComponentSFCRuntimeHost'
import type { FilterRuntimeHost } from '@/features/core/modules/runtime/hosts/FilterRuntimeHost'
import type { FilterViewRuntimeHost } from '@/features/core/modules/runtime/hosts/FilterViewRuntimeHost'
import type { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import type { StoreRuntimeHost } from '@/features/core/modules/runtime/hosts/StoreRuntimeHost'
import type { StreamRuntimeHost } from '@/features/core/modules/runtime/hosts/StreamRuntimeHost'
import type { OperationHistoryShortcutBinding } from '@/features/core/modules/runtime/operation/operation-history'
import type {
  CompositionBindingValue,
  CompositionComponentEventEffect,
  CompositionFilterFieldsSlice,
  CompositionProgramPayload,
  CompositionPublicOutputHandle,
  CompositionRuntimeActivationHandle,
  CompositionRuntimeChildHandle,
  CompositionRuntimeOutputHandle,
  CompositionRuntimePublicationConnection,
  OperationHistoryShortcutDescriptor,
} from '@/features/core/modules/source/domain/types/composition-source.types'

import type { StreamEventEnvelope } from '@/features/core/modules/source/domain/types/stream-source.types'

import type { StoreMutationPlan } from '@/features/core/modules/source/domain/types/update-source.types'
import { collectionByKey, filterByKey, full, Raph, RaphNode } from '@endge/raph'
import { Endge } from '@/features/core/kernel/endge'
import { normalizeComponentSFCInteractionTriggers } from '@/features/core/modules/domain/component/component-sfc-edit-trigger'
import { buildCompositionI18nCatalogs, cloneI18nRuntimeCatalog } from '@/features/core/modules/i18n/services/i18n-catalog'
import { FilterViewRuntimeHost as EndgeFilterViewRuntimeHost } from '@/features/core/modules/runtime/hosts/FilterViewRuntimeHost'
import { OperationHistory } from '@/features/core/modules/runtime/operation/operation-history'
import { RuntimeHostBase } from '@/features/core/modules/runtime/RuntimeHostBase'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'
import { evaluateSourceExpression } from '@/features/core/modules/source/services/source-expression-evaluate'

function defaultContext(): RuntimeHostContext<'composition'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    mountedChildren: 0,
    lastHookAt: null,
  }
}

function evaluateComponentEventInput(
  value: ComponentSFCEventInputValue,
  payload: unknown,
  evaluatedAt = new Date().toISOString(),
): unknown {
  if (value.kind === 'event') {
    return value.path == null ? payload : readValuePath(payload, value.path)
  }
  if (value.kind === 'operation-input') {
    return undefined
  }
  if (value.kind === 'now') {
    return evaluatedAt
  }
  if (value.kind === 'literal') {
    return value.value
  }
  if (value.kind === 'scope') {
    return undefined
  }
  if (value.kind === 'coalesce') {
    const left = evaluateComponentEventInput(value.left, payload, evaluatedAt)
    return left ?? evaluateComponentEventInput(value.right, payload, evaluatedAt)
  }
  if (value.kind === 'array') {
    return value.items.map(item => evaluateComponentEventInput(item, payload, evaluatedAt))
  }
  return Object.fromEntries(value.entries.map(entry => [
    typeof entry.key === 'string' ? entry.key : String(evaluateComponentEventInput(entry.key, payload, evaluatedAt)),
    evaluateComponentEventInput(entry.value, payload, evaluatedAt),
  ]))
}

/** Runtime orchestration host: children, bindings, hooks и public handles. */
export class CompositionRuntimeHost extends RuntimeHostBase<'composition', RuntimeHostContext<'composition'>, CompositionProgramPayload> {
  private _children = new Map<string, RuntimeHost<any, any>>()
  private _childDescriptors = new Map<string, CompositionProgramPayload['runtimes'][number]>()
  private _publicOutputs: Record<string, CompositionPublicOutputHandle> = {}
  private _scopes = new Map<string, RuntimeScope>()
  private _runtimeHandles = new Map<string, CompositionRuntimeActivationHandle>()
  private _outputBridges = new Map<string, string>()
  private _updateSourcePaths = new Map<string, string>()
  private _outputBridgeDisposers = new Map<string, () => void>()
  private _hookDisposers = new Map<string, () => void>()
  private _publicationDisposers = new Map<string, () => void>()
  private _disposers: Array<() => void> = []
  private _bridgePaths = new Set<string>()
  private _bindingDerivedHandles: RaphDerivedHandle[] = []
  private _dataPaths = new Map<string, string>()
  private _storeRuntimeIds = new Map<string, string>()
  private _storeProviderRuntimeIds = new Map<string, Set<string>>()
  private _ownedStoreRuntimeIds = new Set<string>()
  private _compositionInputBindings = new Map<string, RuntimeHostInputBinding>()
  private _i18nCatalogs = new Map<string, I18nRuntimeCatalog>()
  private _vocabCatalogs = new Map<string, VocabRuntimeCatalog>()
  private _orchestratedQueries = new Set<string>()
  private _orchestratedSuccesses = new Set<string>()
  private _streamBatches = new Map<string, StreamEventEnvelope[]>()
  private _streamBatchTimers = new Map<string, ReturnType<typeof setTimeout>>()
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
    if (!artifact || artifact.status === 'error') {
      return null
    }

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
    host.setInputSource(input.meta?.input as RuntimeHostInputSource | undefined)
    return host
  }

  /** Создает children, bindings и hooks. Повторный mount является no-op. */
  public async mountGraph(): Promise<void> {
    if (this._mounted) {
      return
    }
    const payload = this.getArtifactPayload()
    if (!payload) {
      throw new Error(`[CompositionRuntimeHost] artifact is missing for "${this.entityIdentity}".`)
    }

    try {
      this._assertRequiredProps(payload)
      this._mountData(payload)
      this._buildVocabCatalogs(payload)
      this._prepareOutputBridges(payload)
      this._buildI18nCatalogs(payload)
      this._buildLifecycleScopes(payload)
      const rootScope = this._requireScope('scope_default')
      await rootScope.activate()
      this._makeOutputs(payload)
      this._mounted = true
      const now = new Date().toISOString()
      this.setContext({ status: 'success', startedAt: now, updatedAt: now, mountedChildren: this._children.size })

      this._bindHooks(payload)
      for (const mount of payload.graph.mounts) {
        if (!this._children.has(mount.targetRuntime)) {
          throw new Error(`[CompositionRuntimeHost] onMount target "${mount.targetRuntime}" is inactive.`)
        }
      }
      await this._runQueries(payload.graph.mounts.map(mount => mount.targetRuntime))
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
      if (!descriptor) {
        throw new Error(`[CompositionRuntimeHost] descriptor "${name}" is missing.`)
      }
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

  public getOutputs(): Readonly<Record<string, CompositionPublicOutputHandle>> {
    return { ...this._publicOutputs }
  }

  public getScope(path: string): RuntimeScope | null {
    return this._scopes.get(String(path ?? '').trim()) ?? null
  }

  /** Возвращает накопленный translation catalog для заданного lifecycle scope. */
  public getI18nCatalog(scopePath = 'scope_default'): I18nRuntimeCatalog {
    return cloneI18nRuntimeCatalog(this._i18nCatalogs.get(scopePath) ?? {})
  }

  /** Возвращает накопленный Vocab catalog для заданного lifecycle scope. */
  public getVocabCatalog(scopePath = 'scope_default'): VocabRuntimeCatalog {
    return { ...(this._vocabCatalogs.get(scopePath) ?? {}) }
  }

  public getRuntimeHandle(path: string): CompositionRuntimeActivationHandle | null {
    return this._runtimeHandles.get(String(path ?? '').trim()) ?? null
  }

  /** Возвращает текущее значение публичного Composition output. */
  public getOutput(name: string): unknown {
    const key = String(name ?? '').trim()
    const handle = this._publicOutputs[key]
    if (!handle) {
      return undefined
    }
    if ('boundaryId' in handle) {
      return handle
    }
    if ('activate' in handle) {
      const descriptor = this.getArtifactPayload()?.outputs.find(output => output.key === key)
      return descriptor?.kind === 'runtime' && descriptor.output
        ? handle.getOutput(descriptor.output)
        : handle
    }
    return handle.output ? handle.runtime ? Raph.get(handle.runtime.outputPath(handle.output)) : undefined : handle.runtime
  }

  /** Текущие значения data-блока для preview и runtime debugger. */
  public getDataSnapshot(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
      Array.from(this._dataPaths.entries()).map(([name, path]) => [name, Raph.get(path)]),
    )
  }

  /** Возвращает текущие значения публичных Composition props. */
  public getProps(): Readonly<Record<string, unknown>> {
    return this.readInputs()
  }

  /** Императивное локальное изменение для UI-сценариев, которым не нужен сохраняемый RUpdate. */
  public mutateStore(dataAlias: string, plan: StoreMutationPlan): void {
    this._requireStoreRuntime(dataAlias).applyMutation(plan)
  }

  /** Явно вызывает один именованный RUpdate, принадлежащий Store, вне dispatch Stream. */
  public applyStoreUpdate(dataAlias: string, updateIdentity: string, payload: unknown): void {
    this._requireStoreRuntime(dataAlias).applyUpdate(updateIdentity, payload)
  }

  /** Сопоставляет артефакт Update с alias данных Store, принадлежащим этой Composition. */
  public applyUpdateByIdentity(updateIdentity: string, payload: unknown): void {
    const update = Endge.program.getUpdateArtifact(updateIdentity)
    if (!update) {
      throw new Error(`[CompositionRuntimeHost] Update artifact is missing: ${updateIdentity}.`)
    }
    const data = this.getArtifactPayload()?.data.find(item => item.kind === 'store' && item.identity === update.payload.storeIdentity)
    if (!data) {
      throw new Error(`[CompositionRuntimeHost] Store "${update.payload.storeIdentity}" is not mounted for Update "${updateIdentity}".`)
    }
    this.applyStoreUpdate(data.path ?? data.name, updateIdentity, payload)
  }

  /** Устанавливает literal/Raph-backed источник публичных Composition props. */
  public setInputSource(input: RuntimeHostInputSource | null | undefined): void {
    const payload = this.getArtifactPayload()
    if (!payload) {
      return
    }

    this._compositionInputBindings.clear()
    for (const descriptor of payload.props) {
      if (descriptor.defaultValue === undefined) {
        continue
      }
      const value = evaluateSourceExpression(descriptor.defaultValue, {
        environment: name => Endge.workspace.variables.resolve(`{${name}}`) || `{${name}}`,
      })
      const binding: RuntimeHostInputBinding = { kind: 'literal', value }
      this._compositionInputBindings.set(descriptor.key, binding)
      this.bindInput(descriptor.key, binding)
    }

    const literals = input?.props ?? {}
    for (const [name, value] of Object.entries(literals)) {
      const binding: RuntimeHostInputBinding = { kind: 'literal', value }
      this._compositionInputBindings.set(name, binding)
      this.bindInput(name, binding)
    }
    if (input?.kind === 'raph') {
      for (const [name, source] of Object.entries(input.bindings)) {
        const binding: RuntimeHostInputBinding = { kind: 'raph', path: source.path }
        this._compositionInputBindings.set(name, binding)
        this.bindInput(name, binding)
      }
    }
  }

  /** Проверяет обязательные props до создания child runtime graph. */
  private _assertRequiredProps(payload: CompositionProgramPayload): void {
    for (const descriptor of payload.props) {
      if (descriptor.optional || descriptor.defaultValue !== undefined) {
        continue
      }
      if (this.readInput(descriptor.key) === undefined) {
        throw new Error(`[CompositionRuntimeHost] Required prop "${descriptor.key}" is missing for "${this.entityIdentity}".`)
      }
    }
  }

  /** Возвращает runtime Raph path объявленной data-зависимости. */
  public getDataPath(name: string, path = ''): string {
    return this._requireDataPath(name, path)
  }

  private _buildLifecycleScopes(payload: CompositionProgramPayload): void {
    const ownerScope = Endge.runtime.getRuntimeScopeByHost(this.id)
    for (const descriptor of [...payload.scopes].sort((left, right) => left.sourceOrder - right.sourceOrder)) {
      const parent = descriptor.parentPath
        ? this._scopes.get(descriptor.parentPath) ?? null
        : ownerScope
      if (descriptor.parentPath && !parent) {
        throw new Error(`[CompositionRuntimeHost] Parent scope "${descriptor.parentPath}" is missing.`)
      }
      const id = `${this.id}:scope:${descriptor.path}`
      const scope = new RuntimeScope({
        id,
        path: descriptor.path,
        boundaryId: id,
        parent,
        ownerRuntimeId: this.id,
        hooks: {
          activate: () => this._activateScope(descriptor, payload),
          reconcile: async () => {
            for (const runtimePath of descriptor.runtimes) {
              await this._children.get(runtimePath)?.reconcile?.()
            }
          },
          deactivate: () => this._forgetScopeRuntimes(descriptor.path),
          destroyRuntime: runtimeId => Endge.runtime.destroyRuntimeTreeAsync(runtimeId),
          resolveRuntime: path => this._children.get(path) ?? null,
          resolveOutput: name => this.getOutput(name),
        },
      })
      this._scopes.set(descriptor.path, scope)
      Endge.runtime.scopes.register(scope)
    }
    for (const descriptor of payload.runtimes) {
      this._runtimeHandles.set(descriptor.path, this._createRuntimeHandle(descriptor))
    }
  }

  private async _activateScope(
    descriptor: CompositionProgramPayload['scopes'][number],
    payload: CompositionProgramPayload,
  ): Promise<void> {
    const scope = this._requireScope(descriptor.path)
    const dataMode = Endge.runtime.resolveDataMode(this) === 'mock' ? 'mock' : 'live'
    const scopeData = descriptor.data ?? payload.data
      .filter(data => (data.scopePath ?? 'scope_default') === descriptor.path)
      .map(data => data.path ?? data.name)
    await Promise.all(scopeData.map(async (dataPath) => {
      const data = payload.data.find(item => (item.path ?? item.name) === dataPath)
      if (!data || data.kind !== 'vocab') {
        return
      }
      await Endge.vocabs.acquire([data.identity], data.policy, { dataMode })
    }))

    Endge.styles.transaction(() => {
      for (const resourcePath of descriptor.resources) {
        const resource = payload.resources.find(item => item.path === resourcePath)
        if (!resource || resource.kind !== 'style') {
          continue
        }
        scope.resources.add(Endge.styles.acquireStyle({
          artifactIdentity: resource.identity,
          ownerScopeId: scope.id,
          boundaryId: scope.id,
          orderKey: `${String(resource.sourceOrder).padStart(8, '0')}:${resource.identity}`,
        }))
      }
    })

    for (const resourcePath of descriptor.resources) {
      const resource = payload.resources.find(item => item.path === resourcePath)
      if (!resource || resource.kind !== 'operation-history') {
        continue
      }
      const history = new OperationHistory({
        id: `${scope.id}:operation-history`,
        limit: resolveOperationHistoryLimit(resource.operationHistory),
        shortcuts: resolveOperationHistoryShortcuts(resource.operationHistory?.shortcuts ?? null),
      })
      const unregister = Endge.runtime.operations.register(scope, history)
      scope.resources.add({
        id: history.id,
        kind: history.kind,
        pause: () => history.pause(),
        resume: () => history.resume(),
        dispose: () => {
          unregister()
          history.dispose()
        },
      })
    }

    const runtimeDescriptors = this._dependencyOrder(
      payload.runtimes.filter(item => item.scopePath === descriptor.path && item.effectiveActivation.mode === 'startup'),
    )
    for (const runtime of runtimeDescriptors) {
      if (!this._children.has(runtime.path)) {
        await this._createChild(runtime)
      }
    }
    for (const runtime of runtimeDescriptors) {
      this._bindChild(runtime)
    }

    const childScopes = payload.scopes
      .filter(item => item.parentPath === descriptor.path && item.effectiveActivation.mode === 'startup')
      .sort((left, right) => left.sourceOrder - right.sourceOrder)
    for (const child of childScopes) {
      await this._requireScope(child.path).activate()
    }
    this._bindHooks(payload)
  }

  private _forgetScopeRuntimes(scopePath: string): void {
    for (const [path, descriptor] of this._childDescriptors) {
      if (descriptor.scopePath !== scopePath) {
        continue
      }
      this._forgetRuntime(path)
    }
  }

  private _forgetRuntime(path: string): void {
    for (const connection of this.getArtifactPayload()?.graph.updates ?? []) {
      if (connection.targetRuntime !== path) {
        continue
      }
      this._hookDisposers.get(connection.id)?.()
      this._hookDisposers.delete(connection.id)
    }
    if ((this.getArtifactPayload()?.graph.successes ?? []).some(connection => connection.sourceRuntime === path)) {
      const id = this._successHookId(path)
      this._hookDisposers.get(id)?.()
      this._hookDisposers.delete(id)
    }
    for (const publication of this.getArtifactPayload()?.graph.publications ?? []) {
      if (publication.sourceRuntime !== path) {
        continue
      }
      this._publicationDisposers.get(publication.id)?.()
      this._publicationDisposers.delete(publication.id)
    }
    this._disconnectRuntimeOutputs(path)
    this._children.delete(path)
    this._childDescriptors.delete(path)
  }

  private _createRuntimeHandle(
    descriptor: CompositionProgramPayload['runtimes'][number],
  ): CompositionRuntimeActivationHandle {
    let disposed = false
    const getRuntime = (): RuntimeHost<any, any> | null => this._children.get(descriptor.path) ?? null
    return {
      path: descriptor.path,
      get state() {
        if (disposed) {
          return 'disposed'
        }
        const runtime = getRuntime()
        if (!runtime) {
          return 'inactive'
        }
        return runtime.status === 'paused' ? 'paused' : 'active'
      },
      get runtime() { return getRuntime() },
      activate: async () => {
        if (disposed) {
          throw new Error(`[CompositionRuntimeHost] Runtime handle "${descriptor.path}" is disposed.`)
        }
        const scope = this._requireScope(descriptor.scopePath)
        if (scope.state !== 'active') {
          await scope.activate()
        }
        let runtime = getRuntime()
        if (!runtime) {
          await this._createChild(descriptor)
          this._bindChild(descriptor)
          const payload = this.getArtifactPayload()
          if (payload) {
            this._bindHooks(payload)
          }
          runtime = getRuntime()
        }
        if (!runtime) {
          throw new Error(`[CompositionRuntimeHost] Runtime "${descriptor.path}" cannot be activated.`)
        }
        return runtime
      },
      pause: async () => { await getRuntime()?.pause?.() },
      resume: async () => { await getRuntime()?.resume?.() },
      deactivate: async () => {
        const runtime = getRuntime()
        if (!runtime) {
          return
        }
        await Endge.runtime.destroyRuntimeTreeAsync(runtime.id)
        this._forgetRuntime(descriptor.path)
      },
      dispose: async () => {
        await this._runtimeHandles.get(descriptor.path)?.deactivate()
        disposed = true
      },
      getOutput: (name) => {
        const runtime = getRuntime() as any
        if (!runtime) {
          return undefined
        }
        return runtime.getOutput?.(name) ?? Raph.get(runtime.outputPath(name))
      },
    }
  }

  private _requireScope(path: string): RuntimeScope {
    const scope = this._scopes.get(path)
    if (!scope) {
      throw new Error(`[CompositionRuntimeHost] Scope "${path}" is missing.`)
    }
    return scope
  }

  private _prepareOutputBridges(payload: CompositionProgramPayload): void {
    for (const connection of payload.graph.inputs) {
      for (const binding of this._flattenBindings(connection.source)) {
        if (binding.kind === 'output') {
          this._requireOutputBridge(binding.runtime, binding.output)
        }
        else if (binding.kind === 'outputs') {
          for (const output of this._requireResolvedOutputs(binding.runtime, binding.outputs)) {
            this._requireOutputBridge(binding.runtime, output)
          }
        }
        else if (binding.kind === 'expression') {
          for (const read of this._collectExpressionReads(binding.expression)) {
            if (read.source === 'composition-output') {
              this._requireOutputBridge(read.parameters?.[0] ?? '', read.parameters?.[1] ?? '')
            }
            else if (read.source === 'composition-outputs') {
              const [runtime = '', ...outputs] = read.parameters ?? []
              for (const output of outputs) {
                this._requireOutputBridge(runtime, output)
              }
            }
          }
        }
      }
    }
    for (const connection of payload.graph.updates) {
      const sourcePath = connection.source.kind === 'runtime-output'
        ? this._requireOutputBridge(connection.source.runtime, connection.source.output)
        : this._materializeBinding('__hooks__', connection.id, {
            kind: 'expression',
            expression: { type: 'read', source: 'prop', path: connection.source.path },
          })
      this._updateSourcePaths.set(connection.id, sourcePath)
    }
    for (const connection of payload.graph.publications) {
      this._requireOutputBridge(connection.sourceRuntime, connection.sourceOutput)
    }
    for (const output of payload.outputs) {
      if (output.kind === 'runtime' && output.output) {
        this._requireOutputBridge(output.runtime, output.output)
      }
    }
  }

  private _outputBridgeKey(runtime: string, output: string): string {
    return `${runtime}\u0000${output}`
  }

  private _requireOutputBridge(runtime: string, output: string): string {
    const key = this._outputBridgeKey(runtime, output)
    const existing = this._outputBridges.get(key)
    if (existing) {
      return existing
    }
    const path = `${this.basePath}.runtimeOutputs.${encodePathPart(runtime)}.${encodePathPart(output)}`
    this._outputBridges.set(key, path)
    this._bridgePaths.add(path)
    return path
  }

  private _connectRuntimeOutputs(runtimePath: string, runtime: RuntimeHost<any, any>): void {
    const prefix = `${runtimePath}\u0000`
    for (const [key, bridgePath] of this._outputBridges) {
      if (!key.startsWith(prefix)) {
        continue
      }
      this._outputBridgeDisposers.get(key)?.()
      const output = key.slice(prefix.length)
      const sourcePath = runtime.outputPath(output)
      const sync = () => {
        const value = Raph.get(sourcePath)
        if (value === undefined) {
          if (Raph.get(bridgePath) !== undefined) {
            Raph.delete(bridgePath)
          }
        }
        else {
          Raph.set(bridgePath, value)
        }
      }
      sync()
      this._outputBridgeDisposers.set(key, Raph.watch([sourcePath, `${sourcePath}.*`], sync))
    }
  }

  private _disconnectRuntimeOutputs(runtimePath: string): void {
    const prefix = `${runtimePath}\u0000`
    for (const [key, bridgePath] of this._outputBridges) {
      if (!key.startsWith(prefix)) {
        continue
      }
      this._outputBridgeDisposers.get(key)?.()
      this._outputBridgeDisposers.delete(key)
      if (Raph.get(bridgePath) !== undefined) {
        Raph.delete(bridgePath)
      }
    }
  }

  public override quiesce(): void {
    super.quiesce()
    for (const timer of this._streamBatchTimers.values()) {
      clearTimeout(timer)
    }
    this._streamBatchTimers.clear()
    this._streamBatches.clear()
    for (const handle of [...this._bindingDerivedHandles].reverse()) {
      handle.dispose()
    }
    this._bindingDerivedHandles = []
    for (const dispose of this._disposers) {
      dispose()
    }
    this._disposers = []
    for (const path of this._bridgePaths) {
      Raph.delete(path)
    }
    this._bridgePaths.clear()
    for (const dispose of this._outputBridgeDisposers.values()) {
      dispose()
    }
    this._outputBridgeDisposers.clear()
    for (const dispose of this._hookDisposers.values()) {
      dispose()
    }
    this._hookDisposers.clear()
    for (const dispose of this._publicationDisposers.values()) {
      dispose()
    }
    this._publicationDisposers.clear()
  }

  public override async destroy(): Promise<void> {
    this.quiesce()
    for (const child of this._children.values()) {
      if (Endge.runtime.getRuntimeById(child.id)) {
        await Endge.runtime.destroyRuntimeTreeAsync(child.id)
      }
      else if (child.status !== 'destroyed') {
        await child.destroy()
      }
    }
    for (const runtimeId of this._ownedStoreRuntimeIds) {
      if (Endge.runtime.getRuntimeById(runtimeId)) {
        await Endge.runtime.destroyRuntimeTreeAsync(runtimeId)
      }
    }
    this._ownedStoreRuntimeIds.clear()
    this._children.clear()
    this._childDescriptors.clear()
    this._publicOutputs = {}
    for (const scope of [...this._scopes.values()].reverse()) {
      await Endge.runtime.scopes.remove(scope.id)
    }
    this._scopes.clear()
    this._runtimeHandles.clear()
    this._outputBridges.clear()
    this._updateSourcePaths.clear()
    this._dataPaths.clear()
    this._storeRuntimeIds.clear()
    this._storeProviderRuntimeIds.clear()
    this._compositionInputBindings.clear()
    this._i18nCatalogs.clear()
    this._vocabCatalogs.clear()
    this._orchestratedQueries.clear()
    this._orchestratedSuccesses.clear()
    this._mounted = false
    super.destroy()
  }

  /** Строит effective catalogs по той же иерархии, что и lifecycle scopes. */
  private _buildI18nCatalogs(payload: CompositionProgramPayload): void {
    const inherited = (this.meta.i18nCatalog ?? {}) as I18nRuntimeCatalog
    this._i18nCatalogs = buildCompositionI18nCatalogs(payload, inherited)
  }

  /** Строит nearest-scope catalog публичных Vocab aliases поверх shared cache paths. */
  private _buildVocabCatalogs(payload: CompositionProgramPayload): void {
    this._vocabCatalogs.clear()
    const inherited = (this.meta.vocabCatalog ?? {}) as VocabRuntimeCatalog

    for (const scope of [...payload.scopes].sort((left, right) => left.sourceOrder - right.sourceOrder)) {
      const parent = scope.parentPath
        ? this._vocabCatalogs.get(scope.parentPath) ?? inherited
        : inherited
      const catalog: VocabRuntimeCatalog = { ...parent }

      for (const descriptor of payload.data) {
        if (descriptor.kind !== 'vocab' || (descriptor.scopePath ?? 'scope_default') !== scope.path) {
          continue
        }
        const descriptorPath = descriptor.path ?? descriptor.name
        const path = this._dataPaths.get(descriptorPath)
        if (!path) {
          throw new Error(`[CompositionRuntimeHost] Vocab data path "${descriptorPath}" is missing.`)
        }
        catalog[descriptor.name] = {
          identity: descriptor.identity,
          path,
        }
      }

      this._vocabCatalogs.set(scope.path, catalog)
    }
  }

  /** Регистрирует shared Vocab paths и разрешает Store aliases через explicit, ancestor или local provider. */
  private _mountData(payload: CompositionProgramPayload): void {
    const explicitStoreRuntimes = (
      this.meta.dataRuntimes && typeof this.meta.dataRuntimes === 'object'
        ? this.meta.dataRuntimes
        : {}
    ) as Record<string, unknown>
    for (const descriptor of payload.data) {
      const descriptorPath = descriptor.path ?? descriptor.name

      if (descriptor.kind === 'vocab') {
        const vocabPath = `vocabs.${descriptor.identity}`
        this._dataPaths.set(descriptorPath, vocabPath)
        this.addResource({
          id: `data:${descriptorPath}`,
          kind: 'meta',
          title: `Data ${descriptor.name}`,
          subtitle: descriptor.identity,
          payload: {
            path: vocabPath,
            kind: descriptor.kind,
            identity: descriptor.identity,
            ownership: 'shared',
            scopePath: descriptor.scopePath ?? 'scope_default',
            policy: descriptor.policy,
          },
        })
        continue
      }

      const store = Endge.domain.getStore(descriptor.identity)
      if (!store) {
        throw new Error(`[CompositionRuntimeHost] Store data "${descriptor.identity}" is missing.`)
      }
      const explicitRuntimeId = String(explicitStoreRuntimes[descriptorPath] ?? explicitStoreRuntimes[descriptor.name] ?? '').trim()
      let storeRuntime: StoreRuntimeHost | null = null
      let ownership: 'owned' | 'borrowed' = 'owned'
      let provider: 'explicit' | 'ancestor' | 'local' = 'local'
      if (explicitRuntimeId) {
        storeRuntime = Endge.runtime.getRuntimeById<StoreRuntimeHost>(explicitRuntimeId)
        ownership = 'borrowed'
        provider = 'explicit'
        if (!storeRuntime || storeRuntime.entityType !== 'store') {
          throw new Error(`[CompositionRuntimeHost] Store runtime "${explicitRuntimeId}" for data alias "${descriptor.name}" is missing.`)
        }
        if (storeRuntime.entityIdentity !== descriptor.identity) {
          throw new Error(`[CompositionRuntimeHost] Store runtime "${explicitRuntimeId}" has identity "${storeRuntime.entityIdentity}" instead of "${descriptor.identity}".`)
        }
      }
      else if (descriptor.resolution !== 'isolated') {
        storeRuntime = this._findAncestorStoreProvider(descriptor.identity, descriptor.slot)
        if (storeRuntime) {
          ownership = 'borrowed'
          provider = 'ancestor'
        }
        else if (descriptor.resolution === 'injected') {
          throw new Error(`[CompositionRuntimeHost] Injected Store data "${descriptor.name}" requires provider "${descriptor.identity}"${descriptor.slot ? ` in slot "${descriptor.slot}"` : ''}.`)
        }
      }
      if (!storeRuntime) {
        storeRuntime = Endge.runtime.execute(store, {
          parent: this,
          persistence: 'disabled',
          meta: { instance: descriptor.name },
        }) as StoreRuntimeHost | null
        if (!storeRuntime) {
          throw new Error(`[CompositionRuntimeHost] Store runtime for "${descriptor.identity}" cannot be created.`)
        }
        this._ownedStoreRuntimeIds.add(storeRuntime.id)
      }

      const storePath = storeRuntime.getDataPath()
      this._dataPaths.set(descriptorPath, storePath)
      this._storeRuntimeIds.set(descriptorPath, storeRuntime.id)
      this._registerStoreProvider(descriptor.identity, descriptor.slot, storeRuntime.id)
      this.addResource({
        id: `data:${descriptorPath}`,
        kind: 'meta',
        title: `Store ${descriptor.name}`,
        subtitle: descriptor.identity,
        payload: {
          path: storePath,
          kind: descriptor.kind,
          identity: descriptor.identity,
          runtimeId: storeRuntime.id,
          ownership,
          provider,
          resolution: descriptor.resolution ?? 'contextual',
          slot: descriptor.slot ?? null,
        },
      })
    }
  }

  /** Находит ближайший Store provider только среди Composition ancestors. */
  private _findAncestorStoreProvider(identity: string, slot: string | null | undefined): StoreRuntimeHost | null {
    const key = storeProviderKey(identity, slot)
    let current = this.parent
    while (current) {
      if (current instanceof CompositionRuntimeHost) {
        const runtimeIds = current._storeProviderRuntimeIds.get(key)
        if (runtimeIds?.size) {
          if (runtimeIds.size > 1) {
            throw new Error(`[CompositionRuntimeHost] Store provider "${identity}"${slot ? ` in slot "${slot}"` : ''} is ambiguous in ancestor "${current.entityIdentity}".`)
          }
          const runtimeId = runtimeIds.values().next().value as string
          const runtime = Endge.runtime.getRuntimeById<StoreRuntimeHost>(runtimeId)
          if (!runtime || runtime.entityType !== 'store') {
            throw new Error(`[CompositionRuntimeHost] Store provider runtime "${runtimeId}" is missing.`)
          }
          return runtime
        }
      }
      current = current.parent
    }
    return null
  }

  /** Публикует resolved Store instance для descendants этой Composition. */
  private _registerStoreProvider(identity: string, slot: string | null | undefined, runtimeId: string): void {
    const key = storeProviderKey(identity, slot)
    const runtimeIds = this._storeProviderRuntimeIds.get(key) ?? new Set<string>()
    runtimeIds.add(runtimeId)
    this._storeProviderRuntimeIds.set(key, runtimeIds)
  }

  /** Атомарно публикует накопленный batch runtime outputs в writable Store data. */
  private _publishUpdates(publications: CompositionRuntimePublicationConnection[]): void {
    const writes: Array<{ runtimeId: string, path: string, value: unknown }> = []
    for (const publication of publications) {
      const runtimeId = this._storeRuntimeIds.get(publication.targetData)
      const storeRuntime = runtimeId
        ? Endge.runtime.getRuntimeById<StoreRuntimeHost>(runtimeId)
        : null
      if (!storeRuntime || storeRuntime.entityType !== 'store') {
        throw new Error(`[CompositionRuntimeHost] Store data "${publication.targetData}" is not mounted.`)
      }
      if (!storeRuntime.isWritable(publication.targetPath)) {
        throw new Error(`[CompositionRuntimeHost] Store target "${publication.targetData}.${publication.targetPath}" is derived or missing.`)
      }
      const source = this._children.get(publication.sourceRuntime)
      if (!source) {
        throw new Error(`[CompositionRuntimeHost] Runtime "${publication.sourceRuntime}" is missing.`)
      }
      writes.push({
        runtimeId: storeRuntime.id,
        path: publication.targetPath,
        value: Raph.get(this._requireOutputBridge(publication.sourceRuntime, publication.sourceOutput)),
      })
    }

    Raph.transaction(() => {
      for (const write of writes) {
        const storeRuntime = Endge.runtime.getRuntimeById<StoreRuntimeHost>(write.runtimeId)
        if (!storeRuntime) {
          throw new Error(`[CompositionRuntimeHost] Store runtime "${write.runtimeId}" was replaced or removed.`)
        }
        storeRuntime.set(write.path, write.value)
      }
    })
    this.emit('data:change', this.getDataSnapshot())
  }

  protected override onUpdate(ctx: RuntimeHostUpdateContext): void {
    const publications = (ctx.updates ?? [])
      .filter(update => update.kind === 'publish')
      .map(update => update.payload as CompositionRuntimePublicationConnection)
    if (publications.length) {
      this._publishUpdates(publications)
    }
    this.emit('update', ctx)
  }

  private _requireDataPath(name: string, path = ''): string {
    const basePath = this._dataPaths.get(name)
    if (!basePath) {
      throw new Error(`[CompositionRuntimeHost] Data alias "${name}" is missing.`)
    }
    return path ? `${basePath}.${path.split('.').map(encodePathPart).join('.')}` : basePath
  }

  private _requireStoreRuntime(dataAlias: string): StoreRuntimeHost {
    const runtimeId = this._storeRuntimeIds.get(String(dataAlias ?? '').trim())
    const runtime = runtimeId ? Endge.runtime.getRuntimeById<StoreRuntimeHost>(runtimeId) : null
    if (!runtime || runtime.entityType !== 'store') {
      throw new Error(`[CompositionRuntimeHost] Store data "${dataAlias}" is not mounted.`)
    }
    return runtime
  }

  private _resolveDataReference(reference: string): { data: string, path: string } | null {
    const data = [...this._dataPaths.keys()]
      .sort((left, right) => right.length - left.length)
      .find(candidate => reference === candidate || reference.startsWith(`${candidate}.`))
    if (!data) {
      return null
    }
    return {
      data,
      path: reference === data ? '' : reference.slice(data.length + 1),
    }
  }

  private async _createChild(descriptor: CompositionProgramPayload['runtimes'][number]): Promise<void> {
    if (descriptor.kind === 'filter-view') {
      const source = this._children.get(descriptor.identity) as FilterRuntimeHost | undefined
      if (!source || source.entityType !== 'filter' || source.runtimeType !== 'filter-runtime-host') {
        throw new Error(`[CompositionRuntimeHost] filterView source runtime "${descriptor.identity}" is missing.`)
      }
      const initialProps = Object.fromEntries(
        Object.entries(this._compiledInputs(descriptor.name))
          .map(([key, binding]) => [key, this._readBinding(binding)]),
      )
      const appScope = Endge.runtime.getAppScope(String(this.meta.appScopeId ?? ''))
        ?? Endge.runtime.getDefaultAppScope()
      const filterViewAddress = appScope.allocate({
        entityType: 'filter',
        identity: source.entityIdentity,
        scopeRoot: false,
      })
      const child = new EndgeFilterViewRuntimeHost({
        id: filterViewAddress.runtimeId,
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
          appScopeId: appScope.id,
          appScopeRootPath: appScope.rootPath,
          instance: descriptor.name,
          runtimeLocalId: filterViewAddress.localId,
          runtimePath: filterViewAddress.runtimePath,
          scopeRoot: false,
          sourceRuntime: descriptor.identity,
          persistence: this.meta.persistence ?? 'disabled',
          runtimeScopeId: this._requireScope(descriptor.scopePath).id,
          i18nCatalog: this.getI18nCatalog(descriptor.scopePath),
          vocabCatalog: this.getVocabCatalog(descriptor.scopePath),
        },
      })
      const node = new RaphNode(Raph.app, {
        id: `${this.id}:${descriptor.name}:root`,
        meta: { type: 'runtime-node', kind: 'root', runtimeId: child.id },
      })
      Raph.app.addNode(node)
      child.addRaphNode(node)
      if (!Endge.runtime.registerRuntimeHost(child)) {
        child.destroy()
        throw new Error(`[CompositionRuntimeHost] filterView runtime "${descriptor.name}" cannot be registered.`)
      }
      this._children.set(descriptor.name, child)
      this._childDescriptors.set(descriptor.name, descriptor)
      this._connectRuntimeOutputs(descriptor.name, child)
      return
    }

    let model: any = null
    if (descriptor.kind === 'filter') {
      model = Endge.domain.getFilter(descriptor.identity)
    }
    else if (descriptor.kind === 'query') {
      model = Endge.domain.getQuery(descriptor.identity)
    }
    else if (descriptor.kind === 'stream') {
      model = Endge.domain.getStream(descriptor.identity)
    }
    else if (descriptor.kind === 'composition') {
      model = Endge.domain.getComposition(descriptor.identity)
    }
    else { model = Endge.domain.getComponentSFC(descriptor.identity) ?? Endge.domain.getComponent(descriptor.identity) }
    if (!model) {
      throw new Error(`[CompositionRuntimeHost] model "${descriptor.identity}" is missing.`)
    }

    if (descriptor.kind === 'composition') {
      this._assertCompositionCycle(descriptor.identity)
    }

    const initialProps = Object.fromEntries(
      Object.entries(this._compiledInputs(descriptor.name))
        .map(([key, binding]) => [key, this._readBinding(binding)]),
    )
    const basePath = `${this.basePath}.children.${encodePathPart(descriptor.name)}.props`
    const meta: Record<string, unknown> = {
      instance: descriptor.name,
      props: initialProps,
      basePath,
      input: { kind: 'local', props: initialProps },
      runtimeScopeId: this._requireScope(descriptor.scopePath).id,
      i18nCatalog: this.getI18nCatalog(descriptor.scopePath),
      vocabCatalog: this.getVocabCatalog(descriptor.scopePath),
    }
    if (descriptor.kind === 'composition') {
      meta.input = this._makeInputSource(descriptor.name)
      const dataRuntimes = Object.fromEntries(
        (this.getArtifactPayload()?.graph.dataInputs ?? [])
          .filter(connection => connection.targetRuntime === descriptor.name)
          .map((connection) => {
            const runtimeId = this._storeRuntimeIds.get(connection.sourceData)
            if (!runtimeId) {
              throw new Error(`[CompositionRuntimeHost] Store data "${connection.sourceData}" is not mounted for nested Composition "${descriptor.name}".`)
            }
            return [connection.targetData, runtimeId]
          }),
      )
      if (Object.keys(dataRuntimes).length) {
        meta.dataRuntimes = dataRuntimes
      }
    }
    if (descriptor.kind === 'component') {
      Raph.set(basePath, initialProps)
      this._bridgePaths.add(basePath)
    }

    const child = Endge.runtime.execute(model, {
      parent: this,
      artifactReader: this.getArtifactReader() ?? undefined,
      persistence: descriptor.persistKey ? 'local' : 'disabled',
      persistenceKey: descriptor.persistKey,
      meta,
    })
    if (!child) {
      throw new Error(`[CompositionRuntimeHost] runtime "${descriptor.name}" cannot be created.`)
    }
    this._children.set(descriptor.name, child)
    this._childDescriptors.set(descriptor.name, descriptor)
    this._connectRuntimeOutputs(descriptor.name, child)
    if (descriptor.kind === 'composition') {
      await (child as unknown as CompositionRuntimeHost).mountGraph()
    }
  }

  private _bindChild(descriptor: CompositionProgramPayload['runtimes'][number]): void {
    const child = this._children.get(descriptor.name)
    if (!child) {
      return
    }
    const inputBindings = this._compiledInputs(descriptor.name)

    if (descriptor.kind === 'filter-view') {
      const filterView = child as unknown as FilterViewRuntimeHost
      for (const [prop, binding] of Object.entries(inputBindings)) {
        if (binding.kind === 'literal') {
          continue
        }
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

    if (descriptor.kind === 'stream') {
      this._bindStreamDispatch(descriptor, child as unknown as StreamRuntimeHost)
      return
    }

    if (descriptor.kind === 'composition') {
      return
    }

    if (descriptor.kind !== 'component') {
      return
    }
    const modelType = String((child.model as any)?.type ?? '')
    if (modelType === 'component-sfc') {
      const literals: Record<string, unknown> = {}
      const bindings: Record<string, { path: string }> = {}
      for (const [prop, binding] of Object.entries(inputBindings)) {
        if (binding.kind === 'literal') {
          literals[prop] = binding.value
          continue
        }
        const path = this._bindingPath(descriptor.name, prop, binding)
        bindings[prop] = { path }
      }
      const input: RuntimeHostInputSource = Object.keys(bindings).length
        ? { kind: 'raph', bindings, props: literals }
        : { kind: 'local', props: literals }
      ;(child as unknown as ComponentSFCRuntimeHost).setInputSource(input)
      this._bindComponentDispatch(descriptor, child as unknown as ComponentSFCRuntimeHost)
      return
    }

    const basePath = String(child.meta.basePath ?? '')
    const syncLegacy = () => {
      const props = Object.fromEntries(Object.entries(inputBindings).map(([key, binding]) => [key, this._readBinding(binding)]))
      Raph.set(basePath, props)
    }
    syncLegacy()
    for (const binding of Object.values(inputBindings)) {
      this._subscribeBinding(binding, syncLegacy)
    }
  }

  private _bindStreamDispatch(
    descriptor: CompositionProgramPayload['runtimes'][number],
    stream: StreamRuntimeHost,
  ): void {
    if (!descriptor.dispatchTo?.length) {
      return
    }
    const stores = descriptor.dispatchTo.map((dataAlias) => {
      const runtimeId = this._storeRuntimeIds.get(dataAlias)
      const store = runtimeId ? Endge.runtime.getRuntimeById<StoreRuntimeHost>(runtimeId) : null
      if (!store || store.entityType !== 'store') {
        throw new Error(`[CompositionRuntimeHost] Store data "${dataAlias}" is not mounted.`)
      }
      return store
    })

    const receive = (event: StreamEventEnvelope) => {
      const batch = descriptor.batch
      if (!batch || (batch.maxItems === 1 && batch.maxWaitMs === 0)) {
        Raph.transaction(() => {
          for (const store of stores) {
            store.dispatch(event)
          }
        })
        return
      }
      const pending = this._streamBatches.get(descriptor.name) ?? []
      pending.push(event)
      this._streamBatches.set(descriptor.name, pending)
      if (pending.length >= batch.maxItems) {
        this._flushStreamBatch(descriptor.name, stores)
        return
      }
      if (batch.maxWaitMs > 0 && !this._streamBatchTimers.has(descriptor.name)) {
        this._streamBatchTimers.set(descriptor.name, setTimeout(
          () => this._flushStreamBatch(descriptor.name, stores),
          batch.maxWaitMs,
        ))
      }
    }
    stream.on('event', receive)
    this._disposers.push(() => stream.off('event', receive))
  }

  private _bindComponentDispatch(
    descriptor: CompositionProgramPayload['runtimes'][number],
    component: ComponentSFCRuntimeHost,
  ): void {
    if (!descriptor.dispatchTo?.length) {
      return
    }
    const stores = descriptor.dispatchTo.map(dataAlias => this._requireStoreRuntime(dataAlias))
    for (const port of component.getIr()?.script.ports.emits.events ?? []) {
      const dispose = component.onEventPort(port.name, (occurrence) => {
        const envelope: StreamEventEnvelope = {
          type: occurrence.event,
          payload: occurrence.payload,
          meta: {
            id: null,
            source: component.entityIdentity,
            sourceEvent: occurrence.event,
            occurredAt: new Date().toISOString(),
          },
        }
        Raph.transaction(() => {
          for (const store of stores) {
            store.dispatch(envelope)
          }
        })
      })
      this._disposers.push(dispose)
    }
  }

  private _flushStreamBatch(name: string, stores: StoreRuntimeHost[]): void {
    const timer = this._streamBatchTimers.get(name)
    if (timer) {
      clearTimeout(timer)
    }
    this._streamBatchTimers.delete(name)
    const events = this._streamBatches.get(name) ?? []
    this._streamBatches.delete(name)
    if (!events.length) {
      return
    }
    Raph.transaction(() => {
      for (const event of events) {
        for (const store of stores) {
          store.dispatch(event)
        }
      }
    })
  }

  private _makeOutputs(payload: CompositionProgramPayload): void {
    this._publicOutputs = Object.fromEntries(payload.outputs.map((output) => {
      if (output.kind === 'scope') {
        return [output.key, this._requireScope(output.scope)]
      }
      const runtime = this._children.get(output.runtime) ?? null
      if (output.output) {
        const sourcePath = this._requireOutputBridge(output.runtime, output.output)
        const targetPath = this.outputPath(output.key)
        const sync = () => {
          const value = Raph.get(sourcePath)
          if (value === undefined) {
            if (Raph.get(targetPath) !== undefined) {
              Raph.delete(targetPath)
            }
          }
          else {
            Raph.set(targetPath, value)
          }
        }
        sync()
        this._disposers.push(Raph.watch([sourcePath, `${sourcePath}.*`], sync))
      }
      if (!runtime) {
        return [output.key, this._runtimeHandles.get(output.runtime) ?? { kind: 'runtime', runtime: null, output: output.output }]
      }
      const handle: CompositionRuntimeOutputHandle = { kind: 'runtime', runtime, output: output.output }
      return [output.key, handle]
    }))
  }

  /** Не допускает прямые и транзитивные циклы Composition runtime tree. */
  private _assertCompositionCycle(identity: string): void {
    if (this.entityIdentity === identity) {
      throw new Error(`[CompositionRuntimeHost] composition cycle detected for "${identity}".`)
    }
    let current: RuntimeHost<any, any> | null = this.parent
    while (current) {
      if (current.entityType === 'composition' && current.entityIdentity === identity) {
        throw new Error(`[CompositionRuntimeHost] composition cycle detected for "${identity}".`)
      }
      current = current.parent
    }
  }

  private _bindHooks(payload: CompositionProgramPayload): void {
    for (const connection of payload.graph.events ?? []) {
      if (this._hookDisposers.has(connection.id)) {
        continue
      }
      const source = this._children.get(connection.runtime)
      if (!source || source.entityType !== 'component-sfc') {
        continue
      }
      const component = source as unknown as ComponentSFCRuntimeHost
      this._hookDisposers.set(connection.id, component.onEventPort(connection.event, (occurrence) => {
        void this._executeComponentEventEffect(connection.effect, occurrence, connection.runtime)
      }))
    }

    for (const connection of payload.graph.updates) {
      if (this._hookDisposers.has(connection.id)) {
        continue
      }
      const target = this._children.get(connection.targetRuntime)
      const sourcePath = this._updateSourcePaths.get(connection.id)
      if (!sourcePath || !target) {
        continue
      }
      this._hookDisposers.set(connection.id, target.bindUpdate({
        id: connection.id,
        sourcePath,
        update: { kind: connection.updateKind },
        policy: { debounceMs: connection.debounceMs },
      }))
    }

    const successSources = new Set<string>()
    for (const connection of payload.graph.successes ?? []) {
      if (this._children.has(connection.sourceRuntime)) {
        successSources.add(connection.sourceRuntime)
      }
    }
    for (const sourceRuntime of successSources) {
      const id = this._successHookId(sourceRuntime)
      if (this._hookDisposers.has(id)) {
        continue
      }
      const source = this._children.get(sourceRuntime) as unknown as QueryRuntimeHost
      const runTargets = (): void => {
        if (this._orchestratedQueries.has(sourceRuntime)) {
          this._orchestratedSuccesses.add(sourceRuntime)
          return
        }
        void this._runSuccessTargets(sourceRuntime, payload).catch(() => undefined)
      }
      source.on('run:success', runTargets)
      this._hookDisposers.set(id, () => source.off('run:success', runTargets))
    }

    for (const publication of payload.graph.publications) {
      if (this._publicationDisposers.has(publication.id)) {
        continue
      }
      const source = this._children.get(publication.sourceRuntime)
      if (!source) {
        continue
      }
      this._publicationDisposers.set(publication.id, this.bindUpdate({
        id: publication.id,
        sourcePath: this._requireOutputBridge(publication.sourceRuntime, publication.sourceOutput),
        update: { kind: 'publish', payload: publication },
      }))
    }

    const initialPublications = payload.graph.publications.filter((publication) => {
      const source = this._children.get(publication.sourceRuntime)
      return source && Raph.get(this._requireOutputBridge(publication.sourceRuntime, publication.sourceOutput)) !== undefined
    })
    if (initialPublications.length) {
      this._publishUpdates(initialPublications)
    }
  }

  private async _executeComponentEventEffect(
    effect: CompositionComponentEventEffect,
    occurrence: ComponentSFCEventOccurrence,
    runtimeAlias: string,
  ): Promise<void> {
    const evaluatedAt = new Date().toISOString()
    try {
      if (effect.kind === 'apply-update') {
        this.applyStoreUpdate(
          effect.data,
          effect.update,
          effect.input ? evaluateComponentEventInput(effect.input, occurrence.payload, evaluatedAt) : occurrence.payload,
        )
        return
      }
      if (effect.kind === 'mutate-store') {
        this.mutateStore(effect.data, {
          strategy: effect.mutation.strategy,
          path: effect.mutation.path,
          ...(effect.mutation.value ? { value: evaluateComponentEventInput(effect.mutation.value, occurrence.payload, evaluatedAt) } : {}),
          ...(effect.mutation.vars
            ? { vars: Object.fromEntries(Object.entries(effect.mutation.vars).map(([key, value]) => [key, evaluateComponentEventInput(value, occurrence.payload, evaluatedAt)])) }
            : {}),
        })
        return
      }
      await Endge.actions.execute(effect.action, {
        input: effect.input ? evaluateComponentEventInput(effect.input, occurrence.payload, evaluatedAt) : occurrence.payload,
        target: occurrence.source?.target,
        context: {
          surface: 'composition-event',
          parentRuntimeId: this.id,
          compositionIdentity: this.entityIdentity,
          runtimeAlias,
          componentIdentity: occurrence.componentIdentity,
          eventName: occurrence.event,
          source: occurrence.source,
        },
        resolution: { composition: this.entityIdentity },
      })
    }
    catch (error) {
      this.emit('event:error', {
        code: 'composition-event-effect-failed',
        runtimeAlias,
        event: occurrence.event,
        effect: effect.kind,
        error,
      })
    }
  }

  private async _runQuery(name: string): Promise<void> {
    const query = this._children.get(name) as unknown as QueryRuntimeHost | undefined
    if (!query || typeof query.run !== 'function') {
      throw new Error(`[CompositionRuntimeHost] Query runtime "${name}" is missing.`)
    }
    this._orchestratedQueries.add(name)
    this._orchestratedSuccesses.delete(name)
    try {
      await query.run()
      const now = new Date().toISOString()
      this.setContext({ updatedAt: now, lastHookAt: now })
      if (this._orchestratedSuccesses.delete(name)) {
        const payload = this.getArtifactPayload()
        if (payload) {
          await this._runSuccessTargets(name, payload)
        }
      }
    }
    finally {
      this._orchestratedQueries.delete(name)
      this._orchestratedSuccesses.delete(name)
    }
  }

  /** Запускает все одновременно готовые Query hooks одним parallel batch. */
  private async _runQueries(names: string[]): Promise<void> {
    await Promise.all(names.map(name => this._runQuery(name)))
  }

  private async _runSuccessTargets(sourceRuntime: string, payload: CompositionProgramPayload): Promise<void> {
    const targets = [...new Set(
      (payload.graph.successes ?? [])
        .filter(connection => connection.sourceRuntime === sourceRuntime && this._children.has(connection.targetRuntime))
        .map(connection => connection.targetRuntime),
    )]
    await this._runQueries(targets)
  }

  private _successHookId(sourceRuntime: string): string {
    return `success:${sourceRuntime}`
  }

  private _readBinding(binding: CompositionBindingValue): unknown {
    if (binding.kind === 'literal') {
      return binding.value
    }
    if (binding.kind === 'store') {
      return Raph.get(binding.key)
    }
    if (binding.kind === 'data') {
      return Raph.get(this._requireDataPath(binding.data, binding.path))
    }
    if (binding.kind === 'runtime-metadata') {
      return this._readRuntimeMetadata(binding.runtime, binding.namespace)
    }
    if (binding.kind === 'filter-fields') {
      return this._readFilterFieldsBinding(binding)
    }
    if (binding.kind === 'data-view') {
      return undefined
    }
    if (binding.kind === 'outputs') {
      return this._readRuntimeOutputs(binding.runtime, this._requireResolvedOutputs(binding.runtime, binding.outputs))
    }
    if (binding.kind === 'expression') {
      return evaluateSourceExpression(binding.expression, {
        environment: name => Endge.workspace.variables.resolve(`{${name}}`) || `{${name}}`,
        read: expression => this._readExpressionSource(expression),
        onWarning: warning => Endge.diagnostics.warn(`[Composition] ${warning.message}`, {
          scope: { name: 'endge.runtime.composition' },
          phase: 'runtime',
          eventName: 'endge.expression.warning',
          attributes: { 'endge.runtime.id': this.id },
        }),
      })
    }
    return this._readRuntimeOutput(binding.runtime, binding.output)
  }

  private _compiledInputs(runtimeName: string): Record<string, CompositionBindingValue> {
    const graph = this.getArtifactPayload()?.graph
    if (!graph) {
      return {}
    }
    return Object.fromEntries(
      graph.inputs
        .filter(connection => connection.targetRuntime === runtimeName)
        .map(connection => [connection.targetProp, connection.source]),
    )
  }

  /** Материализует authored bindings в единый runtime input source child Composition. */
  private _makeInputSource(runtimeName: string): RuntimeHostInputSource {
    const literals: Record<string, unknown> = {}
    const bindings: Record<string, { path: string }> = {}
    for (const [name, binding] of Object.entries(this._compiledInputs(runtimeName))) {
      if (binding.kind === 'literal') {
        literals[name] = binding.value
        continue
      }
      bindings[name] = { path: this._bindingPath(runtimeName, name, binding) }
    }
    return Object.keys(bindings).length
      ? { kind: 'raph', bindings, props: literals }
      : { kind: 'local', props: literals }
  }

  private _subscribeBinding(binding: CompositionBindingValue, sync: () => void): void {
    if (binding.kind === 'literal') {
      return
    }
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
    if (binding.kind === 'runtime-metadata') {
      return
    }
    if (binding.kind === 'data-view') {
      return
    }
    if (binding.kind === 'filter-fields') {
      const runtime = this._children.get(binding.runtime)
      if (!runtime) {
        return
      }
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
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        this._subscribeExpressionRead(read, sync)
      }
      return
    }
    if (binding.kind === 'outputs') {
      const paths = this._requireResolvedOutputs(binding.runtime, binding.outputs)
        .flatMap((output) => {
          const path = this._requireOutputBridge(binding.runtime, output)
          return [path, `${path}.*`]
        })
      if (paths.length) {
        this._disposers.push(Raph.watch(paths, sync))
      }
      return
    }
    const path = this._requireOutputBridge(binding.runtime, binding.output)
    this._disposers.push(Raph.watch([path, `${path}.*`], sync))
  }

  private _bindingPath(
    runtimeName: string,
    prop: string,
    binding: Exclude<CompositionBindingValue, { kind: 'literal' }>,
  ): string {
    if (binding.kind === 'store') {
      return binding.key
    }
    if (binding.kind === 'data') {
      return this._requireDataPath(binding.data, binding.path)
    }
    if (binding.kind === 'data-view') {
      return this._materializeDataViewBinding(runtimeName, prop, binding)
    }
    if (binding.kind === 'output') {
      return this._requireOutputBridge(binding.runtime, binding.output)
    }
    return this._materializeBinding(runtimeName, prop, binding)
  }

  private _materializeBinding(
    runtimeName: string,
    prop: string,
    binding: Extract<CompositionBindingValue, { kind: 'output' | 'outputs' | 'filter-fields' | 'data' | 'runtime-metadata' | 'expression' }>,
  ): string {
    const path = `${this.basePath}.bindings.${encodePathPart(runtimeName)}.${encodePathPart(prop)}`
    const sync = () => Raph.set(path, this._readBinding(binding))
    sync()
    this._subscribeBinding(binding, sync)
    this._bridgePaths.add(path)
    return path
  }

  /** Материализует parameterized DataView binding без отдельного runtime host. */
  private _materializeDataViewBinding(
    runtimeName: string,
    prop: string,
    binding: Extract<CompositionBindingValue, { kind: 'data-view' }>,
  ): string {
    const artifact = Endge.program.getDataViewArtifact(binding.identity)
    if (!artifact || artifact.status === 'error') {
      throw new Error(`[CompositionRuntimeHost] DataView "${binding.identity}" is missing or invalid.`)
    }

    const from = this._requireDataPath(binding.data, binding.path)
    const to = `${this.basePath}.bindings.${encodePathPart(runtimeName)}.${encodePathPart(prop)}`
    const strategy = artifact.payload.materializationStrategy.kind === 'filter-by-key'
      ? filterByKey(artifact.payload.materializationStrategy.key)
      : artifact.payload.materializationStrategy.kind === 'collection-by-key'
        ? collectionByKey(artifact.payload.materializationStrategy.key)
        : full()
    const readProps = () => Object.fromEntries(
      Object.entries(binding.props).map(([key, value]) => [key, this._readBinding(value)]),
    )
    const handle = Raph.derive({
      id: `${this.id}:${runtimeName}:${prop}:data-view`,
      from,
      to,
      strategy,
      disposeTarget: 'delete',
      compute: input => Endge.runtime.dataView.runArtifact(artifact, input, undefined, {
        props: readProps(),
      }),
    })
    this.node?.addChild(handle.node, { invalidate: false })
    this._bindingDerivedHandles.push(handle)
    for (const propBinding of Object.values(binding.props)) {
      this._subscribeBinding(propBinding, () => handle.recompute())
    }
    this._bridgePaths.add(to)
    return to
  }

  /** Гарантирует, что список outputs для fromOutput(runtime) был связан до запуска runtime. */
  private _requireResolvedOutputs(runtime: string, outputs: string[] | undefined): string[] {
    if (!outputs) {
      throw new Error(`[CompositionRuntimeHost] fromOutput("${runtime}") was not linked by the compiler.`)
    }
    return outputs
  }

  /** Читает и распаковывает один именованный runtime output. */
  private _readRuntimeOutput(runtime: string, output: string): unknown {
    const value = Raph.get(this._requireOutputBridge(runtime, output)) as any
    return value?.kind === 'json' ? value.value : value
  }

  /** Собирает объект всех runtime outputs с сохранением их публичных имён. */
  private _readRuntimeOutputs(runtime: string, outputs: string[]): Record<string, unknown> {
    return Object.fromEntries(outputs.map(output => [output, this._readRuntimeOutput(runtime, output)]))
  }

  /** Читает весь compiled metadata map или один namespace сущности runtime alias-а. */
  private _readRuntimeMetadata(runtimePath: string, namespace?: string): unknown {
    const descriptor = this.getArtifactPayload()?.runtimes.find(runtime => runtime.path === runtimePath)
    if (!descriptor) {
      return undefined
    }
    const dependency = descriptor.kind === 'filter-view'
      ? this.getArtifactPayload()?.runtimes.find(runtime => runtime.path === descriptor.identity)
      : descriptor
    if (!dependency) {
      return undefined
    }
    const entityType = dependency.kind === 'component'
      ? 'component-sfc'
      : dependency.kind === 'filter-view'
        ? 'filter'
        : dependency.kind
    const metadata = Endge.program.getArtifact(entityType, dependency.identity)?.metadata.self
    return namespace ? metadata?.[namespace] : metadata
  }

  private _readExpressionSource(
    read: Extract<import('@/features/core/modules/source/domain/types/source-expression.types').SourceExpressionIR, { type: 'read' }>,
  ): unknown {
    const parameters = read.parameters ?? []
    if (read.source === 'composition-output') {
      return this._readRuntimeOutput(parameters[0], parameters[1])
    }
    if (read.source === 'composition-outputs') {
      return this._readRuntimeOutputs(parameters[0], parameters.slice(1))
    }
    if (read.source === 'composition-runtime-metadata') {
      return this._readRuntimeMetadata(parameters[0], parameters[1])
    }
    if (read.source === 'composition-store') {
      return Raph.get(parameters[0])
    }
    if (read.source === 'composition-data') {
      const ref = parameters[0] ?? ''
      const resolved = this._resolveDataReference(ref)
      return resolved ? Raph.get(this._requireDataPath(resolved.data, resolved.path)) : undefined
    }
    if (read.source === 'composition-filter-fields') {
      return this._readFilterFieldsBinding({
        kind: 'filter-fields',
        runtime: parameters[0],
        fields: parameters.slice(1),
      })
    }
    if (read.source === 'prop') {
      const dot = read.path.indexOf('.')
      const prop = dot > 0 ? read.path.slice(0, dot) : read.path
      const path = dot > 0 ? read.path.slice(dot + 1) : ''
      return readValuePath(this.readInput(prop), path)
    }
    if (read.source === 'metadata') {
      return Endge.program.getArtifact(parameters[0] as any, parameters[1])?.metadata
    }
    if (read.source === 'store') {
      return Raph.get(read.path)
    }
    return undefined
  }

  private _collectExpressionReads(
    expression: import('@/features/core/modules/source/domain/types/source-expression.types').SourceExpressionIR,
  ): Array<Extract<import('@/features/core/modules/source/domain/types/source-expression.types').SourceExpressionIR, { type: 'read' }>> {
    if (expression.type === 'read') {
      return [expression]
    }
    if (expression.type === 'operation') {
      return expression.arguments.flatMap(argument => this._collectExpressionReads(argument))
    }
    if (expression.type === 'array') {
      return expression.items.flatMap(argument => this._collectExpressionReads(argument))
    }
    if (expression.type === 'object') {
      return Object.values(expression.properties).flatMap(argument => this._collectExpressionReads(argument))
    }
    return []
  }

  private _flattenBindings(binding: CompositionBindingValue): CompositionBindingValue[] {
    return binding.kind === 'data-view'
      ? [binding, ...Object.values(binding.props).flatMap(item => this._flattenBindings(item))]
      : [binding]
  }

  private _subscribeExpressionRead(
    read: Extract<import('@/features/core/modules/source/domain/types/source-expression.types').SourceExpressionIR, { type: 'read' }>,
    sync: () => void,
  ): void {
    const parameters = read.parameters ?? []
    if (read.source === 'metadata' || read.source === 'composition-runtime-metadata' || read.source === 'current' || read.source === 'env') {
      return
    }
    if (read.source === 'prop') {
      const dot = read.path.indexOf('.')
      const prop = dot > 0 ? read.path.slice(0, dot) : read.path
      const source = this._compositionInputBindings.get(prop)
      if (source?.kind === 'raph') {
        this._disposers.push(Raph.watch([source.path, `${source.path}.*`], sync))
      }
      return
    }
    if (read.source === 'composition-output') {
      const path = this._requireOutputBridge(parameters[0], parameters[1])
      this._disposers.push(Raph.watch([path, `${path}.*`], sync))
      return
    }
    if (read.source === 'composition-outputs') {
      const [runtime = '', ...outputs] = parameters
      const paths = outputs.flatMap((output) => {
        const path = this._requireOutputBridge(runtime, output)
        return [path, `${path}.*`]
      })
      if (paths.length) {
        this._disposers.push(Raph.watch(paths, sync))
      }
      return
    }
    if (read.source === 'composition-filter-fields') {
      const runtime = this._children.get(parameters[0])
      if (runtime) {
        this._disposers.push(Raph.watch([runtime.statePath(), `${runtime.statePath()}.*`], sync))
      }
      return
    }
    if (read.source === 'composition-store' || read.source === 'store') {
      this._disposers.push(Raph.watch(read.source === 'store' ? read.path : parameters[0], sync))
      return
    }
    if (read.source === 'composition-data') {
      const ref = parameters[0] ?? ''
      const resolved = this._resolveDataReference(ref)
      if (!resolved) {
        throw new Error(`[CompositionRuntimeHost] Data reference "${ref}" is missing.`)
      }
      const path = this._requireDataPath(resolved.data, resolved.path)
      this._disposers.push(Raph.watch(`${path}.*`, sync))
    }
  }

  private _readFilterFieldsBinding(binding: Extract<CompositionBindingValue, { kind: 'filter-fields' }>): CompositionFilterFieldsSlice | null {
    const runtime = this._children.get(binding.runtime) as FilterRuntimeHost | undefined
    if (!runtime || typeof runtime.getFields !== 'function' || typeof runtime.getState !== 'function') {
      return null
    }

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
      if (visited.has(name)) {
        return
      }
      if (visiting.has(name)) {
        throw new Error(`[CompositionRuntimeHost] runtime dependency cycle near "${name}".`)
      }
      const runtime = byName.get(name)
      if (!runtime) {
        if (this.getArtifactPayload()?.runtimes.some(item => item.path === name)) {
          return
        }
        throw new Error(`[CompositionRuntimeHost] runtime dependency "${name}" is missing.`)
      }
      visiting.add(name)
      if (runtime.kind === 'filter-view') {
        visit(runtime.identity)
      }
      for (const binding of Object.values(this._compiledInputs(runtime.name))) {
        if (binding.kind === 'output' || binding.kind === 'outputs' || binding.kind === 'filter-fields') {
          visit(binding.runtime)
        }
        else if (binding.kind === 'expression') {
          for (const read of this._collectExpressionReads(binding.expression)) {
            if (read.source === 'composition-output' || read.source === 'composition-outputs' || read.source === 'composition-filter-fields') {
              visit(read.parameters?.[0] ?? '')
            }
          }
        }
      }
      visiting.delete(name)
      visited.add(name)
      ordered.push(runtime)
    }

    for (const runtime of runtimes) {
      visit(runtime.name)
    }
    return ordered
  }
}

function resolveOperationHistoryLimit(options: {
  limit: number
  limitConfigurationPath: string | null
} | undefined): number {
  if (!options?.limitConfigurationPath) {
    return options?.limit ?? 20
  }
  const value = resolveConfigurationValue(options.limitConfigurationPath)
  const limit = Number(value)
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`[OperationHistory] Configuration value "${options.limitConfigurationPath}" must be a positive number.`)
  }
  return Math.floor(limit)
}

function resolveOperationHistoryShortcuts(
  descriptors: OperationHistoryShortcutDescriptor[] | null,
): OperationHistoryShortcutBinding[] | null {
  if (descriptors == null) {
    return null
  }
  return descriptors.map((descriptor) => {
    const value = descriptor.triggerSet.kind === 'literal'
      ? descriptor.triggerSet.value
      : resolveConfigurationValue(descriptor.triggerSet.path)
    const triggers = normalizeComponentSFCInteractionTriggers(value)
    if (!triggers.length) {
      throw new Error(`[OperationHistory] TriggerSet for ${descriptor.command} is empty or invalid.`)
    }
    return { command: descriptor.command, triggers }
  })
}

function resolveConfigurationValue(path: string): unknown {
  let value: unknown = Endge.configuration.current.values
  for (const segment of path.split('.').filter(Boolean)) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !(segment in value)) {
      throw new Error(`[OperationHistory] Configuration value is not resolved: ${path}.`)
    }
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function storeProviderKey(identity: string, slot: string | null | undefined): string {
  return `${String(identity).trim()}\u0000${String(slot ?? '').trim()}`
}

function encodePathPart(value: string): string {
  return encodeURIComponent(String(value)).replace(/\./g, '%2E')
}

function readValuePath(value: unknown, path: string): unknown {
  if (!path) {
    return value
  }
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current == null || typeof current !== 'object') {
      return undefined
    }
    return (current as Record<string, unknown>)[segment]
  }, value)
}
