import type { FlowExecutionResult, FlowExecutionState } from '@/domain/types/endge-flow-runtime.types'
import type { ProgramArtifact, ProgramEntityType } from '@/domain/types/program.types'
import type { RuntimeEntityModelMap, RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type { RuntimeKind } from '@/domain/types/runtime.types'
import type { RaphNode } from '@endge/raph'

export type RuntimeHostStatus
  = 'created'
    | 'active'
    | 'idle'
    | 'stopped'
    | 'destroyed'
    | 'error'

export type RuntimeHostResourceKind
  = 'raph-node'
    | 'behavior-binding'
    | 'contract'
    | 'event-subscription'
    | 'scope'
    | 'meta'

export interface RuntimeHostResource {
  /** Уникальный идентификатор ресурса внутри host. */
  id: string
  /** Тип ресурса (raph-node, binding, contract и т.д.). */
  kind: RuntimeHostResourceKind
  /** Короткий заголовок для UI/инспектора. */
  title: string
  /** Дополнительная подпись для контекста. */
  subtitle?: string
  /** Произвольные метаданные ресурса. */
  payload?: Record<string, unknown>
}

export type RuntimeHostChannelKind
  = 'raph'
    | 'event-contract'
    | 'behavior-bindings'
    | 'event-bus'
    | 'external'

export interface RuntimeHostChannel {
  /** Уникальный идентификатор канала. */
  id: string

  /** Семантический тип канала коммуникации. */
  kind: RuntimeHostChannelKind

  /** Отображаемое имя канала. */
  name: string

  /** Направление потока сообщений для канала. */
  direction: 'in' | 'out' | 'both'

  /** Дополнительная поясняющая подпись. */
  subtitle?: string
}

export interface RuntimeHostContextBase {
  status: 'idle' | 'running' | 'success' | 'error'
  startedAt: string | null
  updatedAt: string | null
}

export interface ActionRuntimeHostContext extends RuntimeHostContextBase {
  /** Нормализованный input последнего запуска action-flow. */
  input: Record<string, unknown>

  /** Каноническое runtime-state action-flow внутри этого host. */
  flowState: FlowExecutionState

  /** Текущий node-id, который считается активным в host. */
  currentNodeId: string | null

  /** Стек вызовов вложенных action-run'ов. */
  callStack: string[]

  /** Последний результат исполнения action-flow. */
  lastFlowResult: FlowExecutionResult | null

  /** Контекст родительского action-host, если этот action вызван из другого flow (иерархия без мутации). */
  parent?: ActionRuntimeHostContext | null
}

export interface QueryRuntimeHostContext extends RuntimeHostContextBase {
  lastFilterChangeAt: string | null
}

export interface TableRuntimeHostContext extends RuntimeHostContextBase {
  lastDataSyncAt: string | null
}

export interface ComponentRuntimeHostContext extends RuntimeHostContextBase {
  lastRenderAt: string | null
}

export interface ComponentSFCRuntimeHostContext extends RuntimeHostContextBase {
  /** Target последней подготовки SFC. */
  target: 'dom' | 'canvas' | null

  /** Время последнего разбора source на вкладки. */
  lastParseAt: string | null

  /** Время последней подготовки compiler placeholders. */
  lastCompileAt: string | null

  /** Время последней попытки render/projection. */
  lastRenderAt: string | null
}

export interface ViewRuntimeHostContext extends RuntimeHostContextBase {
  lastRenderAt: string | null
}

export interface PageRuntimeHostContext extends RuntimeHostContextBase {
  lastRenderAt: string | null
}

export interface ProjectRuntimeHostContext extends RuntimeHostContextBase {
  lastRefreshAt: string | null
}

export interface RuntimeHostContextMap {
  action: ActionRuntimeHostContext
  query: QueryRuntimeHostContext
  table: TableRuntimeHostContext
  component: ComponentRuntimeHostContext
  'component-sfc': ComponentSFCRuntimeHostContext
  view: ViewRuntimeHostContext
  page: PageRuntimeHostContext
  project: ProjectRuntimeHostContext
}

export type RuntimeHostContext<TType extends RuntimeEntityType>
  = RuntimeHostContextMap[TType]

export interface RuntimeHostSnapshot {
  /** Идентификатор runtime-host. */
  id: string

  /** Runtime-id родительского host, если host запущен как дочерний. */
  parentId: string | null

  /** Время удаления host, если snapshot попал в debug-архив удалённых. */
  removedAt: number | null

  /** Технический тип runtime-host реализации. */
  runtimeType: string

  /** Тип доменной сущности, к которой привязан host. */
  entityType: RuntimeEntityType

  /** Identity доменной сущности. */
  entityIdentity: string

  /** Заголовок host для отображения в UI. */
  title: string

  /** Текущий статус жизненного цикла host. */
  status: RuntimeHostStatus

  /** Время создания host (timestamp ms). */
  createdAt: number

  /** Время последнего изменения host (timestamp ms). */
  updatedAt: number

  /** Список ресурсов, связанных с host. */
  resources: RuntimeHostResource[]

  /** Список каналов, через которые host взаимодействует с окружением. */
  channels: RuntimeHostChannel[]

  /** Произвольные метаданные host. */
  meta: Record<string, unknown>

  /** Контекст host (для debug/inspection). */
  context: Record<string, unknown>
}

export interface RuntimeHostLifecycle {
  /** Поднять host и перевести в рабочее состояние. */
  create: () => Promise<void> | void

  /** Корректно остановить host и освободить ресурсы. */
  destroy: () => Promise<void> | void
}

export interface RuntimeArtifactReader {
  getArtifact: <TPayload = unknown>(
    entityType: ProgramEntityType,
    idOrIdentity: string | number,
  ) => ProgramArtifact<TPayload> | null
}

export interface RuntimeHostArtifactRef {
  entityType: ProgramEntityType
  id?: string | number
  identity?: string
}

export interface RuntimeHost<
  TType extends RuntimeEntityType = RuntimeEntityType,
  TContext extends RuntimeHostContext<TType> = RuntimeHostContext<TType>,
  TArtifactPayload = unknown,
> extends RuntimeHostLifecycle {
  /** Уникальный runtime-id host. */
  readonly id: string

  /** Родительский runtime-host для отладки вложенных запусков. */
  readonly parent: RuntimeHost<any, any> | null

  /** Канонический runtime kind (query/table/action/runtime). */
  readonly kind: RuntimeKind | 'runtime'

  /**
   * Имя конкретной runtime-реализации host.
   */
  readonly runtimeType: string
  /** Тип привязанной доменной сущности. */
  readonly entityType: TType

  /** Привязанная доменная модель. */
  readonly model: RuntimeEntityModelMap[TType]

  /** Identity привязанной доменной сущности. */
  readonly entityIdentity: string

  /** Человекочитаемое имя host. */
  readonly title: string

  /** Текущее состояние жизненного цикла host. */
  status: RuntimeHostStatus

  /** Время создания host (timestamp ms). */
  readonly createdAt: number

  /** Время последнего изменения host (timestamp ms). */
  updatedAt: number

  /** Связанные runtime-ресурсы host. */
  readonly resources: RuntimeHostResource[]

  /** Связанные каналы взаимодействия host. */
  readonly channels: RuntimeHostChannel[]

  /** Произвольные runtime-метаданные host. */
  readonly meta: Record<string, unknown>

  /** Контекст runtime-host (тип зависит от host). */
  context: TContext

  /** Корневая raph-нода host (если есть). */
  readonly node: RaphNode | null

  /** Возвращает compiled artifact, связанный с host, если он доступен. */
  getArtifact: () => ProgramArtifact<TArtifactPayload> | null

  /** Возвращает payload compiled artifact, связанный с host, если он доступен. */
  getArtifactPayload: () => TArtifactPayload | null

  /** Изменить статус host и обновить updatedAt. */
  setStatus: (status: RuntimeHostStatus) => void

  /** Добавить/обновить runtime-ресурс host. */
  addResource: (resource: RuntimeHostResource) => void

  /** Добавить/обновить канал host. */
  addChannel: (channel: RuntimeHostChannel) => void

  /** Сгенерировать runtime-событие host. */
  emit: (event: string, payload: any) => void

  /** Подписаться на runtime-событие host. */
  on: (event: string, listener: (payload: any) => void) => any

  /** Отписаться от runtime-события host. */
  off: (event: string, listener: (payload: any) => void) => any

  /** Частично обновить context host. */
  setContext: (patch: Partial<TContext>) => void

  /** Полностью заменить context host. */
  replaceContext: (context: TContext) => void

  /** Сериализовать host в снимок для UI/диагностики. */
  snapshot: () => RuntimeHostSnapshot
}
