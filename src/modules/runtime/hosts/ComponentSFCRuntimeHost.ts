import type { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'
import type {
  RComponentContract,
  RComponentDependencies,
  RComponentRenderTarget,
} from '@/modules/domain/types/component/component-core.types'
import type { RComponentSFC_AST } from '@/modules/domain/types/component/sfc/ast.types'
import type {
  RComponentSFC_RuntimeBoundaryDependency,
  RComponentSFC_RuntimeDependencies,
  RComponentSFC_RuntimeTableColumnDependency,
} from '@/modules/domain/types/component/sfc/dependencies.types'
import type { ComponentSFCEditedEventPayload, RComponentSFC_IR } from '@/modules/domain/types/component/sfc/ir.types'
import type {
  ComponentSFCEventInputValue,
  ComponentSFCEventOccurrence,
  ComponentSFCEventOperationAction,
  ComponentSFCEventOperationBlock,
  ComponentSFCEventPort,
  ComponentSFCEventRuntimeSource,
} from '@/modules/domain/types/component/sfc/ports.types'
import type { RComponentSFCSource_Parts } from '@/modules/domain/types/component/sfc/source.types'
import type { ComputationResource } from '@/modules/domain/types/computation/computation-runtime.types'
import type { I18nRuntimeCatalog } from '@/modules/i18n/domain/i18n.types'
import type {
  ComponentSFCPreviewOptions,
  ComponentSFCProgramPayload,
  ProgramDiagnostic,
} from '@/modules/program/domain/types/program.types'
import type {
  RuntimeArtifactReader,
  RuntimeBoundaryPatch,
  RuntimeCollectionProjectionPatch,
  RuntimeHost,
  RuntimeHostContext,
  RuntimeHostInputSource,
  RuntimeHostUpdateContext,
} from '@/modules/runtime/domain/runtime-host.types'
import type {
  VocabOptionMapping,
  VocabRuntimeCatalog,
} from '@/modules/runtime/domain/vocab-cache.types'
import type { SourceFieldOption } from '@/modules/source/domain/types/source-expression.types'
import type { EndgeStyleLease } from '@/modules/styles/domain/types/style.types'

import { DataPath, Raph, RaphNode } from '@endge/raph'

import { ENDGE_CONTEXT_RAPH_PATH } from '@/kernel/config/kernel.config'
import { Endge } from '@/kernel/endge'
import { createEmptyComponentSFCRuntimeDependencies } from '@/modules/domain/types/component/sfc/dependencies.types'
import { RUNTIME_BOUNDARY_UPDATE_PHASE_NAME } from '@/modules/runtime/domain/runtime-host.types'
import { ComputationResourceRegistry } from '@/modules/runtime/execution/computation/ComputationResourceRegistry'
import { executeRuntimeOperation } from '@/modules/runtime/operation/operation-executor'
import { RuntimeHostBase } from '@/modules/runtime/RuntimeHostBase'

function createDefaultSFCContext(target: RComponentRenderTarget | null): RuntimeHostContext<'component-sfc'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    target,
    lastParseAt: null,
    lastCompileAt: null,
    lastRenderAt: null,
  }
}

function evaluateEventInput(
  value: ComponentSFCEventInputValue,
  payload: unknown,
  scope: Record<string, unknown> = {},
  evaluatedAt = new Date().toISOString(),
  operationInput?: unknown,
): unknown {
  if (value.kind === 'event') {
    return value.path == null ? payload : readPath(payload, value.path)
  }
  if (value.kind === 'operation-input') {
    return value.path == null ? operationInput : readPath(operationInput, value.path)
  }
  if (value.kind === 'now') {
    return evaluatedAt
  }
  if (value.kind === 'scope') {
    return readPath(scope, value.path)
  }
  if (value.kind === 'literal') {
    return value.value
  }
  if (value.kind === 'coalesce') {
    const left = evaluateEventInput(value.left, payload, scope, evaluatedAt, operationInput)
    return left ?? evaluateEventInput(value.right, payload, scope, evaluatedAt, operationInput)
  }
  if (value.kind === 'array') {
    return value.items.map(item => evaluateEventInput(item, payload, scope, evaluatedAt, operationInput))
  }
  return Object.fromEntries(value.entries.map(entry => [
    typeof entry.key === 'string' ? entry.key : String(evaluateEventInput(entry.key, payload, scope, evaluatedAt, operationInput)),
    evaluateEventInput(entry.value, payload, scope, evaluatedAt, operationInput),
  ]))
}

interface MaterializedOperationEffect {
  name: string
  kind: 'action' | 'query'
  identity: string
  input: unknown
}

interface MaterializedOperationBlock {
  steps: MaterializedOperationEffect[]
  output: string | null
}

interface MaterializedInlineOperation {
  input: unknown
  run: MaterializedOperationBlock
  undo: MaterializedOperationBlock
  redo: MaterializedOperationBlock | null
}

function readPath(value: unknown, path: string): unknown {
  return String(path ?? '').split('.').filter(Boolean).reduce<unknown>((current, key) => {
    return isRecord(current) || Array.isArray(current) ? (current as any)[key] : undefined
  }, value)
}

function hashSource(source: string): string {
  let hash = 2166136261
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export interface ComponentSFCEditSession {
  key: string
  originalValue: unknown
  draftValue: unknown
  baseVariant: string
}

/**
 * Runtime-host нового SFC-компонента.
 *
 * Host хранит lifecycle/runtime-состояние и читает compiler-derived данные
 * из `ProgramArtifact<ComponentSFCProgramPayload>`.
 */
export class ComponentSFCRuntimeHost extends RuntimeHostBase<
  'component-sfc',
  RuntimeHostContext<'component-sfc'>,
  ComponentSFCProgramPayload
> {
  private _inputSource: RuntimeHostInputSource | null = null
  private _raphInputDisposers: VoidFunction[] = []
  private readonly _computationResources = new ComputationResourceRegistry()
  private readonly _computationErrorSignatures = new Map<string, string>()
  private _styleLease: EndgeStyleLease | null = null
  private readonly _eventPortListeners = new Map<string, Set<(occurrence: ComponentSFCEventOccurrence) => void>>()
  private readonly _vocabDisposers = new Map<string, VoidFunction>()
  private _editSession: ComponentSFCEditSession | null = null

  constructor(input: {
    id: string
    model: RComponentSFC
    entityIdentity: string
    parent?: RuntimeHost<any, any> | null
    title?: string
    meta?: Record<string, unknown>
    artifactReader?: RuntimeArtifactReader | null
  }) {
    const target = normalizeTarget(input.meta?.target)
    super({
      ...input,
      kind: 'runtime',
      runtimeType: 'component-sfc-runtime-host',
      capabilities: ['renderable'],
      entityType: 'component-sfc',
      context: createDefaultSFCContext(target),
      artifactReader: input.artifactReader,
      artifactRef: {
        entityType: 'component-sfc',
        id: input.model.id,
        identity: input.model.identity,
      },
    })
  }

  /**
   * LIFECYCLE
   */
  public static createRuntime(input: {
    id: string
    model: RComponentSFC
    meta?: Record<string, any>
    parent?: RuntimeHost<any, any> | null
    artifactReader?: RuntimeArtifactReader | null
  }): ComponentSFCRuntimeHost {
    const { id, model } = input
    const meta = input.meta ?? {}
    const parent = input.parent ?? null
    const target = normalizeTarget(meta?.target)

    const node = new RaphNode(Raph.app, {
      id: `${model.identity || model.id}-${id}`,
      meta: {
        ...meta,
        type: 'runtime-node',
        kind: 'root',
        runtimeId: id,
        runtimeKind: 'runtime',
        entityType: 'component-sfc',
        entityIdentity: model.identity,
        entityId: model.id,
        componentIdentity: model.identity,
        parentRuntimeId: parent?.id ?? null,
        target,
      },
    })

    const host = new ComponentSFCRuntimeHost({
      id,
      model,
      entityIdentity: model.identity ?? String(model.id),
      parent,
      title: model.name ?? model.identity ?? `SFC ${model.id}`,
      meta: {
        ...meta,
        runtimeKind: 'runtime',
        parentRuntimeId: parent?.id ?? null,
        target,
      },
      artifactReader: input.artifactReader,
    })

    host.syncArtifactState(target)
    const style = host.getIr()?.style
    const runtimeScopeId = String(meta.runtimeScopeId ?? '').trim()
    if (style && runtimeScopeId) {
      host._styleLease = Endge.styles.acquireStyle({
        artifact: style,
        ownerScopeId: host.id,
        boundaryId: runtimeScopeId,
        orderKey: `sfc:${host.entityIdentity}`,
      })
    }
    Raph.app.addNode(node)
    host.addRaphNode(node)
    host.addResource({
      id: `node:${node.id}`,
      kind: 'raph-node',
      title: node.id,
      subtitle: `${node.meta?.type ?? 'node'}:${node.meta?.kind ?? 'root'}`,
      payload: { meta: node.meta ?? {} },
    })
    host._createRuntimeBoundaryNodes(node)
    host.setInputSource(meta.input)
    host.addResource({
      id: 'artifact:component-sfc',
      kind: 'meta',
      title: 'Compiled SFC artifact',
      subtitle: host.getArtifact()?.status ?? 'missing',
      payload: host._makeArtifactResourcePayload(),
    })
    host.addChannel({
      id: 'channel:event-bus',
      kind: 'event-bus',
      name: 'Endge.events',
      direction: 'both',
      subtitle: 'Публикация и подписка runtime-событий',
    })
    return host
  }

  /** Возвращает разложенный canonical source из compiled artifact. */
  public getSourceParts(): RComponentSFCSource_Parts | null {
    return this.getArtifactPayload()?.sourceParts ?? null
  }

  /** Возвращает diagnostics compiled artifact. */
  public getDiagnostics(): ProgramDiagnostic[] {
    return this.getArtifact()?.diagnostics ?? []
  }

  /** Переводит public key через накопленный Composition catalog этого runtime. */
  public translate(key: string, fallback?: string): string {
    return Endge.i18n.translate(
      (this.meta.i18nCatalog ?? {}) as I18nRuntimeCatalog,
      key,
      fallback,
    )
  }

  /**
   * Читает Vocab alias из ближайшего Composition scope и преобразует cache
   * records в renderer-neutral Select options.
   */
  public resolveVocabOptions(alias: string, mapping?: Partial<VocabOptionMapping>): SourceFieldOption[] {
    const key = String(alias ?? '').trim()
    const catalog = (this.meta.vocabCatalog ?? {}) as VocabRuntimeCatalog
    const entry = catalog[key]
    if (!key || !entry) {
      throw new Error(
        `[ComponentSFCRuntimeHost] Vocab alias "${key || alias}" is not provided for "${this.entityIdentity}".`,
      )
    }

    this._ensureVocabSubscription(key, entry.path)
    const values = Raph.get(entry.path)
    if (!Array.isArray(values)) {
      return []
    }

    const valuePath = String(mapping?.valuePath ?? 'value').trim()
    const labelPath = String(mapping?.labelPath ?? 'label').trim()
    if (!valuePath || !labelPath) {
      throw new Error(`[ComponentSFCRuntimeHost] Vocab alias "${key}" requires non-empty valuePath and labelPath.`)
    }

    return values.flatMap((item): SourceFieldOption[] => {
      const value = readPath(item, valuePath)
      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return []
      }
      const label = readPath(item, labelPath)
      return [{
        value,
        label: label == null ? String(value) : String(label),
      }]
    })
  }

  /** Возвращает внешний контракт компонента из compiled artifact. */
  public getContract(): RComponentContract | null {
    return this.getArtifactPayload()?.contract ?? null
  }

  /** Возвращает зависимости компонента из compiled artifact. */
  public getDependencies(): RComponentDependencies | null {
    return this.getArtifactPayload()?.dependencies ?? null
  }

  /** Возвращает runtime-зависимости SFC v1 из compiled artifact. */
  public getRuntimeDependencies(): RComponentSFC_RuntimeDependencies {
    const dependencies = this.getArtifactPayload()?.runtimeDependencies
      ?? createEmptyComponentSFCRuntimeDependencies()
    return {
      ...dependencies,
      context: dependencies.context ?? [],
      boundaries: dependencies.boundaries.map(boundary => ({
        ...boundary,
        contextReads: boundary.contextReads ?? [],
      })),
      vocabs: dependencies.vocabs ?? [],
    }
  }

  /** Возвращает parser-level AST из compiled artifact. */
  public getAst(): RComponentSFC_AST | null {
    return this.getArtifactPayload()?.ast ?? null
  }

  /** Возвращает target-neutral semantic IR из compiled artifact. */
  public getIr(): RComponentSFC_IR | null {
    return this.getArtifactPayload()?.ir ?? null
  }

  /** Возвращает preview-only props из compiled artifact. */
  public getPreviewProps(): Record<string, unknown> | null {
    return this.getArtifactPayload()?.previewProps ?? null
  }

  /** Возвращает preview-only runtime options из compiled artifact. */
  public getPreviewOptions(): ComponentSFCPreviewOptions | null {
    return this.getArtifactPayload()?.previewOptions ?? null
  }

  /** Subscribes to one public Event port of this mounted component instance. */
  public onEventPort(name: string, listener: (occurrence: ComponentSFCEventOccurrence) => void): () => void {
    const key = String(name ?? '').trim()
    if (!key) {
      throw new Error('Event port name is required.')
    }
    const listeners = this._eventPortListeners.get(key) ?? new Set()
    listeners.add(listener)
    this._eventPortListeners.set(key, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) {
        this._eventPortListeners.delete(key)
      }
    }
  }

  /** Emits an own/public Event through the root Component SFC boundary. */
  public async emitEventPort(name: string, payload: unknown, source?: ComponentSFCEventRuntimeSource): Promise<void> {
    await this._emitRootEventPort(name, payload, source, [], 0)
  }

  /** Executes one compiler-linked Event reaction for a renderer boundary. */
  public async executeEventPortAction(
    ownerIdentity: string,
    port: ComponentSFCEventPort,
    payload: unknown,
    source: ComponentSFCEventRuntimeSource | undefined,
    emitOwn: (name: string, payload: unknown, trace: string[], depth: number) => Promise<void>,
    trace: string[] = [],
    depth = 0,
    scope: Record<string, unknown> = {},
  ): Promise<boolean> {
    if (!port.action) {
      return true
    }
    const traceKey = `${ownerIdentity}.${port.name}`
    if (depth >= 32 || trace.includes(traceKey)) {
      this.emit('event:error', { code: 'event-cycle', ownerIdentity, event: port.name, trace })
      return false
    }
    const nextTrace = [...trace, traceKey]
    const evaluatedAt = new Date().toISOString()
    try {
      if (port.action.kind === 'emit') {
        await emitOwn(
          port.action.event,
          port.action.payload ? evaluateEventInput(port.action.payload, payload, scope, evaluatedAt) : payload,
          nextTrace,
          depth + 1,
        )
        return true
      }
      if (port.action.kind === 'action') {
        await this._executeEventActionEffect(port.action.identity, port.action.input
          ? evaluateEventInput(port.action.input, payload, scope, evaluatedAt)
          : payload, source, ownerIdentity, port.name)
        return true
      }
      if (port.action.kind === 'query') {
        await this._executeEventQueryEffect(
          port.action.identity,
          port.action.input ? evaluateEventInput(port.action.input, payload, scope, evaluatedAt) : {},
        )
        return true
      }
      if (port.action.kind === 'operation') {
        await this._executeInlineOperation(port.action, payload, scope, evaluatedAt, source, ownerIdentity, port.name)
        return true
      }
      if (port.action.kind === 'required-port') {
        throw new Error(`Required port "${port.action.port}" was not resolved by the component boundary.`)
      }

      const inputs = Object.fromEntries(Object.entries(port.action.inputs).map(([key, read]) => [
        key,
        read.path == null ? payload : readPath(payload, read.path),
      ]))
      const result = await Endge.runtime.computation.executeSandbox({
        computationIdentity: `${ownerIdentity}.${port.name}`,
        outputName: 'event-action',
        moduleKey: `event:${ownerIdentity}:${port.name}:${hashSource(port.action.source)}`,
        source: port.action.source,
        inputs,
      })
      const effects = Array.isArray(result) ? result : result == null ? [] : [result]
      if (effects.length > 32) {
        throw new Error('Event reaction effect budget exceeded 32.')
      }
      for (const effect of effects) {
        if (!isRecord(effect)) {
          throw new Error('Event reaction must return JSON effect objects.')
        }
        if (effect.kind === 'action') {
          const identity = String(effect.identity ?? '').trim()
          if (!identity) {
            throw new Error('Event Action effect identity is required.')
          }
          await this._executeEventActionEffect(identity, effect.input, source, ownerIdentity, port.name)
          continue
        }
        if (effect.kind === 'emit') {
          const event = String(effect.event ?? '').trim()
          if (!port.action.emittedEvents.includes(event)) {
            throw new Error(`Event effect is not compiler-linked: ${event}.`)
          }
          await emitOwn(event, effect.payload, nextTrace, depth + 1)
          continue
        }
        throw new Error(`Unsupported Event reaction effect: ${String(effect.kind ?? '')}.`)
      }
      return true
    }
    catch (error) {
      console.error(`[ComponentSFCRuntimeHost] Event reaction failed for "${ownerIdentity}.${port.name}": ${error instanceof Error ? error.message : String(error)}`)
      this.emit('event:error', { code: 'event-reaction-failed', ownerIdentity, event: port.name, error })
      return false
    }
  }

  /** Publishes an already routed root Event without using the global Endge.events bus. */
  public publishEventPort(name: string, payload: unknown, source?: ComponentSFCEventRuntimeSource): void {
    const occurrence: ComponentSFCEventOccurrence = {
      componentIdentity: this.entityIdentity,
      event: name,
      payload,
      source,
    }
    this.emit('event:port', occurrence)
    this.emit(`event:port:${name}`, occurrence)
    for (const listener of this._eventPortListeners.get(name) ?? []) {
      listener(occurrence)
    }
  }

  /** Возвращает активную host-owned edit-сессию конкретного renderer consumer. */
  public getEditSession(key: string): Readonly<ComponentSFCEditSession> | null {
    return this._editSession?.key === key ? this._editSession : null
  }

  /** Открывает единственную edit-сессию runtime; предыдущая отменяется без Event. */
  public beginEditSession(key: string, originalValue: unknown, baseVariant = 'default'): ComponentSFCEditSession {
    const normalizedKey = String(key ?? '').trim()
    if (!normalizedKey) {
      throw new Error('Editable consumer key is required.')
    }
    this._editSession = {
      key: normalizedKey,
      originalValue: cloneEditValue(originalValue),
      draftValue: cloneEditValue(originalValue),
      baseVariant: String(baseVariant ?? '').trim() || 'default',
    }
    this.emit('resource:dirty', { kind: 'editable', action: 'begin', key: normalizedKey })
    return this._editSession
  }

  /** Обновляет renderer-owned draft активной edit-сессии. */
  public updateEditDraft(key: string, value: unknown): void {
    if (this._editSession?.key !== key) {
      return
    }
    this._editSession.draftValue = cloneEditValue(value)
  }

  /** Завершает edit-сессию и возвращает нормализованный semantic payload. */
  public commitEditSession(key: string, value?: unknown): ComponentSFCEditedEventPayload | null {
    const session = this._editSession
    if (!session || session.key !== key) {
      return null
    }
    const payload = {
      value: cloneEditValue(arguments.length >= 2 ? value : session.draftValue),
      previousValue: cloneEditValue(session.originalValue),
    }
    this._editSession = null
    this.emit('resource:dirty', { kind: 'editable', action: 'commit', key })
    return payload
  }

  /** Отменяет edit-сессию без публикации edited. */
  public cancelEditSession(key?: string): void {
    if (!this._editSession || (key && this._editSession.key !== key)) {
      return
    }
    const sessionKey = this._editSession.key
    this._editSession = null
    this.emit('resource:dirty', { kind: 'editable', action: 'cancel', key: sessionKey })
  }

  /** Returns one host-owned computation resource isolated by renderer consumer scope. */
  public getComputationResource(
    identity: string,
    input: unknown,
    consumerKey: string,
    portName?: string,
  ): ComputationResource {
    let resource: ComputationResource | null = null
    resource = this._computationResources.getOrCreate(
      consumerKey,
      input,
      () => Endge.runtime.computation.createResource(identity, input, consumerKey),
      () => {
        if (resource) {
          this._reportComputationError(resource, identity, consumerKey, portName)
        }
        this.emit('computation:dirty', { identity, consumerKey })
      },
    )
    this._reportComputationError(resource, identity, consumerKey, portName)
    return resource
  }

  /** Обновляет input source и пересобирает Raph subscriptions host-а. */
  public setInputSource(input: RuntimeHostInputSource | null | undefined): void {
    this._clearRaphInputSubscriptions()
    this._inputSource = input ?? null

    if (this._inputSource?.kind === 'raph') {
      this._bindRaphInputSource(this._inputSource)
    }
    this._bindRaphContextSources()
  }

  /** Возвращает текущий input source host-а. */
  public getInputSource(): RuntimeHostInputSource | null {
    return this._inputSource
  }

  /**
   * Получает runtime update от universal boundary phase.
   *
   * Core не знает про DOM/Vue/RevoGrid: host только фиксирует update-факт
   * и сообщает render adapter-у, что входные props нужно перечитать.
   */
  public override update(ctx: RuntimeHostUpdateContext): void {
    const now = new Date().toISOString()
    this.setContext({
      status: 'success',
      updatedAt: now,
      lastRenderAt: now,
    })

    const patch = this._makeBoundaryPatch(ctx)
    if (patch) {
      this.emit('boundary:dirty', patch)
      super.update(ctx)
      return
    }

    this.emit('props:dirty', ctx)
    super.update(ctx)
  }

  public override pause(): void {
    super.pause()
    this._styleLease?.suspend()
  }

  public override resume(): void {
    this._styleLease?.resume()
    super.resume()
  }

  /** Очищает Raph subscriptions перед общим destroy host-а. */
  public override destroy(): void {
    this._clearRaphInputSubscriptions()
    for (const dispose of this._vocabDisposers.values()) {
      dispose()
    }
    this._vocabDisposers.clear()
    this._computationResources.dispose()
    this._computationErrorSignatures.clear()
    this._styleLease?.release()
    this._styleLease = null
    this._eventPortListeners.clear()
    this._editSession = null
    super.destroy()
  }

  private async _emitRootEventPort(
    name: string,
    payload: unknown,
    source: ComponentSFCEventRuntimeSource | undefined,
    trace: string[],
    depth: number,
  ): Promise<void> {
    const port = this.getIr()?.script.ports.emits.events.find(candidate => candidate.name === name)
    if (!port) {
      throw new Error(`Component Event port is not declared: ${name}.`)
    }
    this.publishEventPort(name, payload, source)
    await this.executeEventPortAction(
      this.entityIdentity,
      port,
      payload,
      source,
      (event, nextPayload, nextTrace, nextDepth) => this._emitRootEventPort(event, nextPayload, source, nextTrace, nextDepth),
      trace,
      depth,
    )
  }

  private async _executeEventActionEffect(
    identity: string,
    input: unknown,
    source: ComponentSFCEventRuntimeSource | undefined,
    ownerIdentity: string,
    eventName: string,
  ): Promise<unknown> {
    return await Endge.actions.execute(identity, {
      input,
      target: source?.target,
      context: {
        surface: 'component-event',
        parentRuntimeId: this.id,
        componentIdentity: ownerIdentity,
        eventName,
        source,
      },
      resolution: { component: ownerIdentity },
    })
  }

  private async _executeEventQueryEffect(identity: string, input: unknown): Promise<unknown> {
    const query = Endge.domain.getQuery(identity)
    if (!query) {
      throw new Error(`Event Query is missing: ${identity}.`)
    }
    if (!isRecord(input)) {
      throw new Error(`Event Query input must be an object: ${identity}.`)
    }

    return await Endge.runtime.query.run(query, input, this)
  }

  private async _executeInlineOperation(
    operation: ComponentSFCEventOperationAction,
    payload: unknown,
    scope: Record<string, unknown>,
    evaluatedAt: string,
    source: ComponentSFCEventRuntimeSource | undefined,
    ownerIdentity: string,
    eventName: string,
  ): Promise<unknown> {
    const operationInput = operation.input
      ? evaluateEventInput(operation.input, payload, scope, evaluatedAt)
      : payload
    const materialized: MaterializedInlineOperation = {
      input: operationInput,
      run: this._materializeOperationBlock(operation.run, payload, scope, evaluatedAt, operationInput),
      undo: this._materializeOperationBlock(operation.undo, payload, scope, evaluatedAt, operationInput),
      redo: operation.redo
        ? this._materializeOperationBlock(operation.redo, payload, scope, evaluatedAt, operationInput)
        : null,
    }
    return await executeRuntimeOperation({
      id: `${ownerIdentity}.${eventName}:${Date.now()}`,
      input: materialized,
      history: Endge.runtime.operations.resolveForHost(this),
      recordHistory: true,
      run: async context => await this._executeMaterializedOperationBlock(
        (context.input as MaterializedInlineOperation).run,
        source,
        ownerIdentity,
        eventName,
      ),
      undo: async context => await this._executeMaterializedOperationBlock(
        (context.input as MaterializedInlineOperation).undo,
        source,
        ownerIdentity,
        eventName,
      ),
      redo: materialized.redo
        ? async context => await this._executeMaterializedOperationBlock(
          (context.input as MaterializedInlineOperation).redo!,
          source,
          ownerIdentity,
          eventName,
        )
        : null,
    })
  }

  private _materializeOperationBlock(
    block: ComponentSFCEventOperationBlock,
    payload: unknown,
    scope: Record<string, unknown>,
    evaluatedAt: string,
    operationInput: unknown,
  ): MaterializedOperationBlock {
    return {
      output: block.output,
      steps: block.steps.map((step) => {
        if (step.action.kind !== 'action' && step.action.kind !== 'query') {
          throw new Error(`Unsupported inline Operation effect: ${step.action.kind}.`)
        }
        return {
          name: step.name,
          kind: step.action.kind,
          identity: step.action.identity,
          input: step.action.input
            ? evaluateEventInput(step.action.input, payload, scope, evaluatedAt, operationInput)
            : step.action.kind === 'action' ? payload : {},
        }
      }),
    }
  }

  private async _executeMaterializedOperationBlock(
    block: MaterializedOperationBlock,
    source: ComponentSFCEventRuntimeSource | undefined,
    ownerIdentity: string,
    eventName: string,
  ): Promise<unknown> {
    const outputs = new Map<string, unknown>()
    for (const step of block.steps) {
      const result = step.kind === 'query'
        ? await this._executeEventQueryEffect(step.identity, step.input)
        : await this._executeEventActionEffect(step.identity, step.input, source, ownerIdentity, eventName)
      outputs.set(step.name, result)
    }
    return block.output ? outputs.get(block.output) : undefined
  }

  private _reportComputationError(
    resource: ComputationResource,
    identity: string,
    consumerKey: string,
    portName?: string,
  ): void {
    if (!resource.error) {
      this._computationErrorSignatures.delete(consumerKey)
      return
    }
    const signature = `${resource.error.kind}:${resource.error.outputName ?? ''}:${resource.error.message}`
    if (this._computationErrorSignatures.get(consumerKey) === signature) {
      return
    }
    this._computationErrorSignatures.set(consumerKey, signature)
    console.error(`[ComponentSFCRuntimeHost] Computation port failed for "${this.entityIdentity}.${portName ?? 'unknown'}" (${resource.error.computationIdentity || identity}/${resource.error.outputName ?? 'unknown'}, ${resource.error.kind})`)
  }

  /** Синхронизирует runtime context с текущим compiled artifact. */
  public syncArtifactState(target: RComponentRenderTarget | null): void {
    const now = new Date().toISOString()
    const artifact = this.getArtifact()

    this.setContext({
      status: artifact?.status === 'error' || !artifact ? 'error' : 'success',
      startedAt: now,
      updatedAt: now,
      target,
      lastParseAt: artifact ? now : null,
      lastCompileAt: artifact ? now : null,
      lastRenderAt: null,
    })
  }

  /** Backward-compatible alias для старого runtime prepare API. */
  public preparePlaceholders(target: RComponentRenderTarget | null): void {
    this.syncArtifactState(target)
  }

  private _makeArtifactResourcePayload(): Record<string, unknown> {
    const artifact = this.getArtifact()
    if (!artifact) {
      return {
        entityType: 'component-sfc',
        identity: this.entityIdentity,
        missing: true,
      }
    }

    return {
      ref: artifact.ref,
      status: artifact.status,
      sourceHash: artifact.sourceHash,
      compilerVersion: artifact.compilerVersion,
      capabilities: artifact.capabilities,
      diagnostics: artifact.diagnostics.length,
      dependencies: artifact.dependencies.length,
      runtimeDependencies: artifact.payload.runtimeDependencies?.props.length ?? 0,
      runtimeBoundaries: artifact.payload.runtimeDependencies?.boundaries.length ?? 0,
      runtimeVocabs: artifact.payload.runtimeDependencies?.vocabs?.length ?? 0,
    }
  }

  /** Подписывает host на shared Vocab path один раз, включая вложенные SFC artifacts. */
  private _ensureVocabSubscription(alias: string, path: string): void {
    const key = `${alias}\u0000${path}`
    if (this._vocabDisposers.has(key)) {
      return
    }

    const dispose = Raph.watch([path, `${path}.*`], () => {
      this.emit('resource:dirty', { kind: 'vocab', alias, path })
    })
    this._vocabDisposers.set(key, dispose)
  }

  private _createRuntimeBoundaryNodes(root: RaphNode): void {
    const dependencies = this.getRuntimeDependencies()

    for (const boundary of dependencies.boundaries) {
      if (boundary.kind !== 'table') {
        continue
      }

      const tableNode = new RaphNode(Raph.app, {
        id: `${root.id}:table:${boundary.id}`,
        meta: {
          type: 'runtime-node',
          kind: 'boundary',
          boundaryType: 'table',
          boundaryId: boundary.id,
          runtimeId: this.id,
          runtimeKind: 'runtime',
          entityType: 'component-sfc',
          entityIdentity: this.entityIdentity,
          sourceProp: boundary.sourceProp,
          sourcePath: boundary.sourcePath,
          rowKey: boundary.rowKey,
        },
      })

      root.addChild(tableNode, { invalidate: false })
      this.addRaphNode(tableNode)
      this.addResource({
        id: `node:${tableNode.id}`,
        kind: 'raph-node',
        title: tableNode.id,
        subtitle: 'boundary:table',
        payload: { meta: tableNode.meta ?? {} },
      })

      for (const column of boundary.columns) {
        this._createTableColumnBoundaryNode(tableNode, boundary, column)
      }
    }
  }

  private _createTableColumnBoundaryNode(
    tableNode: RaphNode,
    boundary: RComponentSFC_RuntimeBoundaryDependency,
    column: RComponentSFC_RuntimeTableColumnDependency,
  ): void {
    const columnNode = new RaphNode(Raph.app, {
      id: `${tableNode.id}:column:${column.id}`,
      meta: {
        type: 'runtime-node',
        kind: 'boundary',
        boundaryType: 'table-column',
        boundaryId: column.id,
        tableBoundaryId: boundary.id,
        runtimeId: this.id,
        runtimeKind: 'runtime',
        entityType: 'component-sfc',
        entityIdentity: this.entityIdentity,
        sourceProp: boundary.sourceProp,
        sourcePath: boundary.sourcePath,
        rowKey: boundary.rowKey,
        columnKey: column.key,
        columnIndex: column.index,
        rowReads: column.rowReads,
      },
    })

    tableNode.addChild(columnNode, { invalidate: false })
    this.addRaphNode(columnNode)
    this.addResource({
      id: `node:${columnNode.id}`,
      kind: 'raph-node',
      title: columnNode.id,
      subtitle: `boundary:table-column:${column.key}`,
      payload: { meta: columnNode.meta ?? {} },
    })
  }

  private _bindRaphInputSource(input: Extract<RuntimeHostInputSource, { kind: 'raph' }>): void {
    if (!this.node) {
      return
    }

    const deps = this.getRuntimeDependencies()
    for (const dependency of deps.props) {
      if (this._isCoveredByPatchableBoundary(dependency.prop, dependency.path)) {
        continue
      }

      const binding = input.bindings[dependency.prop]
      if (!binding?.path) {
        continue
      }

      const path = this._joinRaphPath(binding.path, dependency.path)
      if (!path) {
        continue
      }

      for (const observedPath of this._makeObservedRaphPaths(path, dependency.path)) {
        const dispose = Raph.app.observeData(this.node, observedPath, {
          phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
          wildcardDynamic: binding.wildcardDynamic ?? true,
        })
        this._raphInputDisposers.push(dispose)
      }
    }

    this._bindRaphBoundaryInputSource(input, deps.boundaries)
  }

  /** Context dependencies are Raph-backed and do not depend on the component props input kind. */
  private _bindRaphContextSources(): void {
    if (!this.node) {
      return
    }

    const dependencies = this.getRuntimeDependencies()
    for (const dependency of dependencies.context) {
      this._observeContextPath(this.node, dependency.path)
    }

    for (const boundary of dependencies.boundaries) {
      if (!boundary.contextReads.length) {
        continue
      }
      const boundaryNode = this._findRuntimeNodeByMeta('boundaryId', boundary.id)
      if (!boundaryNode) {
        continue
      }
      for (const path of boundary.contextReads) {
        this._observeContextPath(boundaryNode, path)
      }
    }
  }

  private _observeContextPath(node: RaphNode, path: string[]): void {
    // Configuration is immutable for one build and deliberately not published to Raph.
    if (path[0] === 'config') {
      return
    }
    const observedPath = this._joinRaphPath(ENDGE_CONTEXT_RAPH_PATH, path)
    if (!observedPath) {
      return
    }
    for (const mask of [observedPath, `${observedPath}.*`]) {
      this._raphInputDisposers.push(Raph.app.observeData(node, mask, {
        phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
        wildcardDynamic: true,
      }))
    }
  }

  private _bindRaphBoundaryInputSource(
    input: Extract<RuntimeHostInputSource, { kind: 'raph' }>,
    boundaries: RComponentSFC_RuntimeBoundaryDependency[],
  ): void {
    for (const boundary of boundaries) {
      const binding = input.bindings[boundary.sourceProp]
      if (!binding?.path) {
        continue
      }

      const sourcePath = this._joinRaphPath(binding.path, boundary.sourcePath)
      if (!sourcePath) {
        continue
      }

      const tableNode = this._findRuntimeNodeByMeta('boundaryId', boundary.id)
      if (tableNode) {
        this._raphInputDisposers.push(Raph.app.observeData(tableNode, sourcePath, {
          phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
          wildcardDynamic: binding.wildcardDynamic ?? true,
        }))
        this._raphInputDisposers.push(Raph.app.observeData(tableNode, `${sourcePath}[*]`, {
          phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
          wildcardDynamic: binding.wildcardDynamic ?? true,
        }))
      }

      for (const column of boundary.columns) {
        const columnNode = this._findRuntimeNodeByMeta('boundaryId', column.id)
        if (!columnNode) {
          continue
        }

        for (const observedPath of this._makeObservedColumnPaths(sourcePath, column)) {
          this._raphInputDisposers.push(Raph.app.observeData(columnNode, observedPath, {
            phase: RUNTIME_BOUNDARY_UPDATE_PHASE_NAME,
            wildcardDynamic: binding.wildcardDynamic ?? true,
          }))
        }
      }
    }
  }

  private _isCoveredByPatchableBoundary(prop: string, path: string[]): boolean {
    return this.getRuntimeDependencies().boundaries.some((boundary) => {
      if (boundary.sourceProp !== prop) {
        return false
      }

      return boundary.sourcePath.every((part, index) => path[index] === part)
    })
  }

  private _findRuntimeNodeByMeta(key: string, value: unknown): RaphNode | null {
    const resource = this.resources.find((item) => {
      if (item.kind !== 'raph-node') {
        return false
      }

      const meta = item.payload?.meta
      return isRecord(meta) && meta[key] === value
    })

    const nodeId = String(resource?.title ?? '').trim()
    if (!nodeId) {
      return null
    }

    return Raph.app.getNode(nodeId) ?? null
  }

  private _makeObservedColumnPaths(
    sourcePath: string,
    column: RComponentSFC_RuntimeTableColumnDependency,
  ): string[] {
    const reads = column.rowReads.length > 0 ? column.rowReads : [column.key]
    return reads.map(read => `${sourcePath}[*].${read}`)
  }

  private _makeBoundaryPatch(ctx: RuntimeHostUpdateContext): RuntimeBoundaryPatch | null {
    if (ctx.node.meta?.boundaryType === 'table-column') {
      return this._makeTableColumnPatch(ctx)
    }
    if (ctx.node.meta?.boundaryType === 'table') {
      return this._makeTableRowPatch(ctx)
    }

    return null
  }

  private _makeTableRowPatch(ctx: RuntimeHostUpdateContext): RuntimeBoundaryPatch | null {
    const meta = ctx.node.meta ?? {}
    const sourcePath = this._resolveBoundarySourcePath(meta)
    if (!sourcePath) {
      return null
    }

    const rowKey = typeof meta.rowKey === 'string' ? meta.rowKey : null
    const boundaryId = String(meta.boundaryId ?? '')
    const boundary = this.getRuntimeDependencies().boundaries.find(item => item.id === boundaryId)
    if (!boundary) {
      return null
    }

    const affectedProjections = boundary.columns.map(column => ({
      boundaryId: column.id,
      key: column.key,
      index: column.index,
    }))
    return this._makeCollectionPatch(ctx, sourcePath, boundaryId, rowKey, affectedProjections)
  }

  private _makeTableColumnPatch(ctx: RuntimeHostUpdateContext): RuntimeBoundaryPatch | null {
    const meta = ctx.node.meta ?? {}
    const sourcePath = this._resolveBoundarySourcePath(meta)
    if (!sourcePath) {
      return null
    }

    const rowKey = typeof meta.rowKey === 'string' ? meta.rowKey : null
    const projection = this._makeColumnProjection(ctx.node)
    const boundaryId = String(meta.tableBoundaryId ?? '')
    if (!boundaryId) {
      return null
    }
    return this._makeCollectionPatch(ctx, sourcePath, boundaryId, rowKey, projection ? [projection] : [])
  }

  /** Собирает все keyed события frame-а, не теряя соседние SSE-изменения. */
  private _makeCollectionPatch(
    ctx: RuntimeHostUpdateContext,
    sourcePath: string,
    boundaryId: string,
    rowKey: string | null,
    affectedProjections: RuntimeCollectionProjectionPatch[],
  ): RuntimeBoundaryPatch | null {
    const sourceSegmentCount = DataPath.from(sourcePath).segments().length
    const collection = Raph.get(sourcePath)
    if (!Array.isArray(collection)) {
      return null
    }

    const groups = new Map<string, { events: typeof ctx.events, selectorKey: string | null, selectorValue: unknown }>()
    for (const event of ctx.events) {
      if (!isCollectionEventPath(sourcePath, event.canonical)) {
        return null
      }
      const selector = DataPath.from(event.canonical).segments()[sourceSegmentCount]
      if (selector?.index == null && !selector?.pkey) {
        return null
      }
      const selectorKey = selector.pkey ?? null
      const selectorValue = selectorKey ? selector.pval : selector.index
      const groupKey = selectorKey
        ? `key:${selectorKey}:${typeof selectorValue}:${String(selectorValue)}`
        : `index:${String(selector.index)}`
      const group = groups.get(groupKey) ?? { events: [], selectorKey, selectorValue }
      group.events.push(event)
      groups.set(groupKey, group)
    }

    const items = [...groups.values()].map((group) => {
      const itemIndex = group.selectorKey
        ? collection.findIndex(item => isRecord(item) && Object.is(item[group.selectorKey!], group.selectorValue))
        : Number(group.selectorValue)
      const resolvedIndex = itemIndex >= 0 && itemIndex < collection.length ? itemIndex : null
      const itemSnapshot = resolvedIndex == null ? null : collection[resolvedIndex]
      const itemKey = group.selectorKey
        ? group.selectorValue
        : rowKey && isRecord(itemSnapshot)
          ? itemSnapshot[rowKey]
          : null
      return {
        itemIndex: resolvedIndex,
        itemKey,
        itemSnapshot,
        changedPaths: group.events
          .map(event => this._extractChangedPath(sourcePath, event.canonical))
          .filter((path): path is string[] => Array.isArray(path)),
      }
    })
    if (items.length === 0) {
      return null
    }
    if (items.length === 1) {
      return {
        kind: 'collection-projection-update',
        boundaryId,
        boundaryType: 'table',
        sourcePath,
        ...items[0]!,
        affectedProjections,
        events: ctx.events,
        node: ctx.node,
      }
    }
    return {
      kind: 'collection-projection-batch',
      boundaryId,
      boundaryType: 'table',
      sourcePath,
      items,
      affectedProjections,
      events: ctx.events,
      node: ctx.node,
    }
  }

  private _resolveBoundarySourcePath(meta: Record<string, unknown>): string {
    if (this._inputSource?.kind !== 'raph') {
      return ''
    }

    const sourceProp = String(meta.sourceProp ?? '').trim()
    const binding = this._inputSource.bindings[sourceProp]
    if (!binding?.path) {
      return ''
    }

    const sourcePath = Array.isArray(meta.sourcePath)
      ? meta.sourcePath.map(part => String(part))
      : []

    return this._joinRaphPath(binding.path, sourcePath)
  }

  private _extractChangedPath(sourcePath: string, canonical: string): string[] | null {
    const sourceSegmentCount = DataPath.from(sourcePath).segments().length
    const segments = DataPath.from(canonical).segments()
    const selector = segments[sourceSegmentCount]
    if (selector?.index == null && !selector?.pkey) {
      return null
    }

    return segments
      .slice(sourceSegmentCount + 1)
      .map((segment) => {
        if (segment.key != null) {
          return segment.key
        }
        if (segment.index != null) {
          return String(segment.index)
        }
        return ''
      })
      .filter(Boolean)
  }

  private _makeColumnProjection(node: RaphNode): RuntimeCollectionProjectionPatch | null {
    const key = String(node.meta?.columnKey ?? '').trim()
    const index = Number(node.meta?.columnIndex)
    if (!key || !Number.isFinite(index)) {
      return null
    }

    return {
      boundaryId: String(node.meta?.boundaryId ?? ''),
      key,
      index,
    }
  }

  private _makeObservedRaphPaths(path: string, dependencyPath: string[]): string[] {
    if (dependencyPath.length > 0) {
      return [path]
    }

    return [path, `${path}.*`]
  }

  private _clearRaphInputSubscriptions(): void {
    for (const dispose of this._raphInputDisposers) {
      dispose()
    }
    this._raphInputDisposers = []
  }

  private _joinRaphPath(basePath: string, childPath: string[]): string {
    const base = String(basePath ?? '').trim().replace(/\.$/, '')
    const child = childPath
      .map(part => String(part ?? '').trim())
      .filter(Boolean)
      .join('.')

    if (!base) {
      return child
    }
    if (!child) {
      return base
    }

    return `${base}.${child}`
  }
}

function isCollectionEventPath(sourcePath: string, canonical: string): boolean {
  return canonical === sourcePath
    || canonical.startsWith(`${sourcePath}.`)
    || canonical.startsWith(`${sourcePath}[`)
}

/** Нормализует target из runtime meta. */
function normalizeTarget(raw: unknown): RComponentRenderTarget | null {
  return raw === 'dom' || raw === 'canvas'
    ? raw
    : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function cloneEditValue<T>(value: T): T {
  if (value == null || typeof value !== 'object') {
    return value
  }
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }
  return JSON.parse(JSON.stringify(value)) as T
}
