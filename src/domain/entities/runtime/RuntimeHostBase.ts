import type { RuntimeEntityModelMap, RuntimeEntityType } from '@/domain/types/runtime/runtime-entity-map.types'
import type { RuntimeStateControllerLike } from '@/domain/types/runtime/context-persistence.types'
import type {
  RuntimeArtifactReader,
  RuntimeHost,
  RuntimeHostArtifactRef,
  RuntimeHostCapability,
  RuntimeHostChannel,
  RuntimeHostContext,
  RuntimeHostInputBinding,
  RuntimeHostResource,
  RuntimeHostResolvedUpdate,
  RuntimeHostSnapshot,
  RuntimeHostStatus,
  RuntimeHostUpdateBinding,
  RuntimeHostUpdateContext,
} from '@/domain/types/runtime/runtime-host.types'
import type { ProgramArtifact } from '@/domain/types/program/program.types'
import type { RuntimeKind } from '@/domain/types/runtime/runtime.types'
import type { RaphNode } from '@endge/raph'

import { Raph } from '@endge/raph'
import { EventBus } from '@endge/utils'

import { RUNTIME_NODE_UPDATE_PHASE_NAME } from '@/domain/types/runtime/runtime-host.types'

export abstract class RuntimeHostBase<
  TType extends RuntimeEntityType,
  TContext extends RuntimeHostContext<TType> = RuntimeHostContext<TType>,
  TArtifactPayload = unknown,
>
  extends EventBus<Record<string, any>>
  implements RuntimeHost<TType, TContext, TArtifactPayload> {
  /** Уникальный runtime-id host. */
  public readonly id: string

  /** Родительский runtime-host для отладки вложенных запусков. */
  public readonly parent: RuntimeHost<any, any> | null

  /** Канонический runtime kind host. */
  public readonly kind: RuntimeKind | 'runtime'

  /** Техническое имя реализации host. */
  public readonly runtimeType: string

  /** Возможности runtime-host, доступные внешним consumers. */
  public readonly capabilities: readonly RuntimeHostCapability[]

  /** Тип доменной сущности, к которой привязан host. */
  public readonly entityType: TType

  /** Экземпляр доменной модели, на которой работает host. */
  public readonly model: RuntimeEntityModelMap[TType]

  /** Identity связанной доменной сущности. */
  public readonly entityIdentity: string

  /** Заголовок host для отображения в UI. */
  public readonly title: string

  /** Текущий статус жизненного цикла host. */
  public status: RuntimeHostStatus

  /** Время создания host (timestamp ms). */
  public readonly createdAt: number

  /** Время последнего изменения host (timestamp ms). */
  public updatedAt: number

  /** Ресурсы, ассоциированные с host. */
  public readonly resources: RuntimeHostResource[]

  /** Каналы, используемые host для коммуникации. */
  public readonly channels: RuntimeHostChannel[]

  /** Произвольные метаданные host. */
  public readonly meta: Record<string, unknown>

  /** Типизированный runtime-контекст host. */
  public context: TContext

  /** Корневая raph-нода host (первая добавленная). */
  public node: RaphNode | null = null

  /** Runtime-scoped namespace данных host. */
  public readonly basePath: string

  /** Runtime-scoped persistence controller. */
  public runtimeState: RuntimeStateControllerLike | null = null

  /** Список raph-нод, которыми владеет host. */
  private _raphNodes = new Map<string, RaphNode>()

  private _inputBindings = new Map<string, RuntimeHostInputBinding>()
  private _updateBindings = new Map<string, RuntimeHostUpdateBinding>()
  private _updateDisposers = new Map<string, Array<() => void>>()
  private _updateHashes = new Map<string, string>()
  private _updateTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Read-only доступ к compiled artifacts, если host связан с program artifact. */
  private readonly _artifactReader: RuntimeArtifactReader | null

  /** Ссылка на compiled artifact, связанный с host. */
  private readonly _artifactRef: RuntimeHostArtifactRef | null

  constructor(input: {

    /** Уникальный runtime-id host. */
    id: string

    /** Родительский runtime-host. */
    parent?: RuntimeHost<any, any> | null

    /** Канонический runtime kind host. */
    kind: RuntimeKind

    /** Техническое имя реализации host. */
    runtimeType: string

    /** Возможности runtime-host, доступные внешним consumers. */
    capabilities?: RuntimeHostCapability[]

    /** Тип доменной сущности. */
    entityType: TType

    /** Экземпляр доменной модели. */
    model: RuntimeEntityModelMap[TType]

    /** Identity доменной сущности. */
    entityIdentity: string

    /** Отображаемое имя host. */
    title?: string

    /** Стартовый статус host. */
    status?: RuntimeHostStatus

    /** Начальные метаданные host. */
    meta?: Record<string, unknown>

    /** Начальный контекст host (тип зависит от реализации). */
    context?: TContext

    /** Read-only доступ к compiled artifacts. */
    artifactReader?: RuntimeArtifactReader | null

    /** Ссылка на artifact, который обслуживает этот host. */
    artifactRef?: RuntimeHostArtifactRef | null
  }) {
    super([])
    this.id = String(input.id)
    this.basePath = String(input.meta?.runtimePath ?? '').trim()
      || `__endge.runtime.${encodePathPart(this.id)}`
    this.parent = input.parent ?? null
    this.kind = input.kind
    this.runtimeType = input.runtimeType
    this.capabilities = [...new Set(input.capabilities ?? [])]
    this.entityType = input.entityType
    this.model = input.model
    this.entityIdentity = String(input.entityIdentity)
    this.title = input.title ?? this.entityIdentity
    this.status = input.status ?? 'created'
    this.createdAt = Date.now()
    this.updatedAt = this.createdAt
    this.resources = []
    this.channels = []
    this.meta = { ...(input.meta ?? {}) }
    this.context = (input.context ?? {} as TContext)
    this._artifactReader = input.artifactReader ?? null
    this._artifactRef = input.artifactRef ?? null
  }

  /**
   * LIFECYCLE
   */
  public create(): void {
    this.mount()
    this.start()
  }

  public mount(): void {
    if (this.status === 'created' || this.status === 'unmounted' || this.status === 'stopped')
      this.setStatus('mounted')
  }

  public start(): void {
    if (this.status === 'mounted')
      this.setStatus('active')
  }

  public pause(): void {
    if (this.status !== 'active' && this.status !== 'running')
      return
    this.setStatus('pausing')
    for (const timer of this._updateTimers.values())
      clearTimeout(timer)
    this._updateTimers.clear()
    this.setStatus('paused')
  }

  public resume(): void {
    if (this.status === 'paused')
      this.setStatus('active')
  }

  public reconcile(): void {}

  public stop(): void {
    if (this.status === 'destroyed' || this.status === 'unmounted' || this.status === 'stopped')
      return
    this.setStatus('stopping')
    for (const timer of this._updateTimers.values())
      clearTimeout(timer)
    this._updateTimers.clear()
    this.setStatus('stopped')
  }

  public unmount(): void {
    if (this.status !== 'destroyed')
      this.setStatus('unmounted')
  }

  /**
   * LIFECYCLE
   */
  public destroy(): void {
    this.setStatus('destroyed')
    for (const timer of this._updateTimers.values())
      clearTimeout(timer)
    this._updateTimers.clear()
    for (const disposers of this._updateDisposers.values()) {
      for (const dispose of disposers)
        dispose()
    }
    this._updateDisposers.clear()
    this._updateBindings.clear()
    this._updateHashes.clear()
    this._inputBindings.clear()
    for (const node of this._raphNodes.values())
      Raph.app.removeNode(node)
    this._raphNodes.clear()
    if (Raph.get(this.basePath) !== undefined)
      Raph.delete(this.basePath)
    this.resources.splice(0)
    this.channels.splice(0)
    ;(this as any).offAll?.()
  }

  /**
   * Обрабатывает универсальный runtime update.
   *
   * Базовая реализация только прокидывает событие наружу, а конкретный host
   * решает, как обновлять свои данные, запросы или render-boundary.
   */
  public update(ctx: RuntimeHostUpdateContext): void {
    if (this.status === 'paused' || this.status === 'stopping' || this.status === 'stopped' || this.status === 'unmounted' || this.status === 'destroyed')
      return
    const immediate: RuntimeHostResolvedUpdate[] = []
    let matchedBinding = false
    for (const binding of this._updateBindings.values()) {
      if (!ctx.events.some(event => pathAffects(binding.sourcePath, event.canonical)))
        continue
      matchedBinding = true

      const distinct = binding.policy?.distinct ?? 'structural'
      const nextHash = structuralHash(Raph.get(binding.sourcePath))
      if (distinct === 'structural' && this._updateHashes.get(binding.id) === nextHash)
        continue
      this._updateHashes.set(binding.id, nextHash)

      const update: RuntimeHostResolvedUpdate = {
        bindingId: binding.id,
        sourcePath: binding.sourcePath,
        kind: binding.update.kind,
        payload: binding.update.payload,
      }
      const debounceMs = Math.max(0, binding.policy?.debounceMs ?? 0)
      if (!debounceMs) {
        immediate.push(update)
        continue
      }

      const previous = this._updateTimers.get(binding.id)
      if (previous)
        clearTimeout(previous)
      this._updateTimers.set(binding.id, setTimeout(() => {
        this._updateTimers.delete(binding.id)
        this.onUpdate({ ...ctx, updates: [update] })
      }, debounceMs))
    }

    if (immediate.length)
      this.onUpdate({ ...ctx, updates: immediate })
    else if (!matchedBinding)
      this.onUpdate(ctx)
  }

  /** Логическая обработка update после разрешения binding-ов. */
  protected onUpdate(ctx: RuntimeHostUpdateContext): Promise<void> | void {
    this.emit('update', ctx)
  }

  public statePath(path = ''): string {
    return appendPath(`${this.basePath}.state`, path)
  }

  public outputPath(name: string): string {
    return appendPath(`${this.basePath}.outputs`, name)
  }

  public bindInput(name: string, binding: RuntimeHostInputBinding): void {
    const key = String(name ?? '').trim()
    if (!key)
      throw new Error('[RuntimeHostBase] Input name is required.')
    this._inputBindings.set(key, binding)
  }

  public readInput(name: string): unknown {
    const binding = this._inputBindings.get(String(name ?? '').trim())
    if (!binding)
      return undefined
    return binding.kind === 'literal' ? binding.value : Raph.get(binding.path)
  }

  public readInputs(): Readonly<Record<string, unknown>> {
    return Object.fromEntries(
      Array.from(this._inputBindings.keys()).map(key => [key, this.readInput(key)]),
    )
  }

  public bindUpdate(binding: RuntimeHostUpdateBinding): () => void {
    if (!this.node)
      throw new Error(`[RuntimeHostBase] Runtime node is missing for "${this.id}".`)
    const id = String(binding.id ?? '').trim()
    const sourcePath = String(binding.sourcePath ?? '').trim()
    if (!id || !sourcePath)
      throw new Error('[RuntimeHostBase] Update binding requires id and sourcePath.')

    this.unbindUpdate(id)
    const normalized: RuntimeHostUpdateBinding = { ...binding, id, sourcePath }
    this._updateBindings.set(id, normalized)
    this._updateHashes.set(id, structuralHash(Raph.get(sourcePath)))
    const disposers = [sourcePath, `${sourcePath}.*`].map(mask => Raph.app.observeData(
      this.node!,
      mask,
      { phase: RUNTIME_NODE_UPDATE_PHASE_NAME },
    ))
    this._updateDisposers.set(id, disposers)
    return () => this.unbindUpdate(id)
  }

  private unbindUpdate(id: string): void {
    for (const dispose of this._updateDisposers.get(id) ?? [])
      dispose()
    this._updateDisposers.delete(id)
    this._updateBindings.delete(id)
    this._updateHashes.delete(id)
    const timer = this._updateTimers.get(id)
    if (timer)
      clearTimeout(timer)
    this._updateTimers.delete(id)
  }

  /**
   * ACCESS
   */
  public setStatus(status: RuntimeHostStatus): void {
    this.status = status
    this.touch()
  }

  /** Проверяет наличие runtime capability. */
  public hasCapability(capability: RuntimeHostCapability): boolean {
    return this.capabilities.includes(capability)
  }

  /**
   * ACCESS
   */
  public addResource(resource: RuntimeHostResource): void {
    const idx = this.resources.findIndex(item => item.id === resource.id)
    if (idx >= 0)
      this.resources[idx] = resource
    else
      this.resources.push(resource)
    this.touch()
  }

  /**
   * ACCESS
   */
  public addChannel(channel: RuntimeHostChannel): void {
    const idx = this.channels.findIndex(item => item.id === channel.id)
    if (idx >= 0)
      this.channels[idx] = channel
    else
      this.channels.push(channel)
    this.touch()
  }

  public setContext(patch: Partial<TContext>): void {
    this.context = {
      ...this.context,
      ...patch,
    }
    this.touch()
  }

  public replaceContext(context: TContext): void {
    this.context = context
    this.touch()
  }

  public attachRuntimeState(runtimeState: RuntimeStateControllerLike | null): void {
    this.runtimeState = runtimeState
    this.touch()
  }

  /**
   * ACCESS
   */
  public addRaphNode(node: RaphNode): void {
    const key = String(node?.id ?? '').trim()
    if (!key)
      return
    this._raphNodes.set(key, node)
    if (!this.node)
      this.node = node
    this.touch()
  }

  /**
   * ACCESS
   */
  public getArtifact(): ProgramArtifact<TArtifactPayload> | null {
    if (!this._artifactReader || !this._artifactRef)
      return null

    const idOrIdentity = this._artifactRef.id ?? this._artifactRef.identity
    if (idOrIdentity == null)
      return null

    return this._artifactReader.getArtifact<TArtifactPayload>(
      this._artifactRef.entityType,
      idOrIdentity,
    )
  }

  /** Возвращает read-only artifact reader текущей runtime session. */
  public getArtifactReader(): RuntimeArtifactReader | null {
    return this._artifactReader
  }

  /**
   * ACCESS
   */
  public getArtifactPayload(): TArtifactPayload | null {
    return this.getArtifact()?.payload ?? null
  }

  /**
   * ACCESS
   */
  public snapshot(): RuntimeHostSnapshot {
    return {
      id: this.id,
      basePath: this.basePath,
      parentId: this.parent?.id ?? null,
      removedAt: null,
      runtimeType: this.runtimeType,
      capabilities: [...this.capabilities],
      entityType: this.entityType,
      entityIdentity: this.entityIdentity,
      title: this.title,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      resources: [...this.resources],
      channels: [...this.channels],
      meta: { ...this.meta },
      context: this.serializeContext(),
    }
  }

  /**
   * ACCESS
   */
  protected touch(): void {
    this.updatedAt = Date.now()
  }

  private serializeContext(): Record<string, unknown> {
    const value = this.context
    if (!value || typeof value !== 'object')
      return {}

    try {
      return structuredClone(value) as Record<string, unknown>
    }
    catch {
      try {
        return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
      }
      catch {
        return {}
      }
    }
  }
}

function appendPath(base: string, path: string): string {
  const suffix = String(path ?? '').trim()
  if (!suffix)
    return base
  return `${base}.${suffix.split('.').map(encodePathPart).join('.')}`
}

function encodePathPart(value: string): string {
  return encodeURIComponent(String(value)).replace(/\./g, '%2E')
}

function pathAffects(sourcePath: string, eventPath: string): boolean {
  return eventPath === sourcePath
    || eventPath.startsWith(`${sourcePath}.`)
    || sourcePath.startsWith(`${eventPath}.`)
}

function structuralHash(value: unknown): string {
  if (value === undefined)
    return 'undefined'
  try {
    return JSON.stringify(normalizeStructuralValue(value)) ?? String(value)
  }
  catch {
    return String(value)
  }
}

function normalizeStructuralValue(value: unknown): unknown {
  if (value instanceof Date)
    return { $date: value.toISOString() }
  if (Array.isArray(value))
    return value.map(normalizeStructuralValue)
  if (!value || typeof value !== 'object')
    return value
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map(key => [key, normalizeStructuralValue((value as Record<string, unknown>)[key])]),
  )
}
