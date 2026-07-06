import type { RuntimeEntityModelMap, RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type {
  RuntimeArtifactReader,
  RuntimeHost,
  RuntimeHostArtifactRef,
  RuntimeHostChannel,
  RuntimeHostContext,
  RuntimeHostResource,
  RuntimeHostSnapshot,
  RuntimeHostStatus,
  RuntimeHostUpdateContext,
} from '@/domain/types/runtime-host.types'
import type { ProgramArtifact } from '@/domain/types/program.types'
import type { RuntimeKind } from '@/domain/types/runtime.types'
import type { RaphNode } from '@endge/raph'

import { Raph } from '@endge/raph'
import { EventBus } from '@endge/utils'

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

  /** Список raph-нод, которыми владеет host. */
  private _raphNodes = new Map<string, RaphNode>()

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
    this.parent = input.parent ?? null
    this.kind = input.kind
    this.runtimeType = input.runtimeType
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
    this.setStatus('active')
  }

  /**
   * LIFECYCLE
   */
  public destroy(): void {
    this.setStatus('destroyed')
    for (const node of this._raphNodes.values())
      Raph.app.removeNode(node)
    this._raphNodes.clear()
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
    this.emit('update', ctx)
  }

  /**
   * ACCESS
   */
  public setStatus(status: RuntimeHostStatus): void {
    this.status = status
    this.touch()
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
      parentId: this.parent?.id ?? null,
      removedAt: null,
      runtimeType: this.runtimeType,
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
