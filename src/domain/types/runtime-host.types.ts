import type { FlowExecutionResult, FlowExecutionState } from '@/domain/types/endge-flow-runtime.types'
import type { RuntimeStateControllerLike } from '@/domain/types/context-persistence.types'
import type { ProgramArtifact, ProgramEntityType } from '@/domain/types/program.types'
import type { RuntimeEntityModelMap, RuntimeEntityType } from '@/domain/types/runtime-entity-map.types'
import type { RuntimeKind } from '@/domain/types/runtime.types'
import type { PhaseEvent, PhaseName, RaphFrameContext, RaphNode } from '@endge/raph'

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

export interface FilterRuntimeHostContext extends RuntimeHostContextBase {
  instance: string
  lastStateChangeAt: string | null
}

export interface CompositionRuntimeHostContext extends RuntimeHostContextBase {
  mountedChildren: number
  lastHookAt: string | null
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
  filter: FilterRuntimeHostContext
  composition: CompositionRuntimeHostContext
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

  /** Обработать runtime update, пришедший из Raph boundary phase. */
  update: (ctx: RuntimeHostUpdateContext) => Promise<void> | void
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

/** Каноническое имя Raph-фазы, которая агрегирует dirty runtime-ноды к root host. */
export const RUNTIME_BOUNDARY_UPDATE_PHASE_NAME = 'runtime-boundary-update' as PhaseName

/** Локальный input source runtime-host-а без привязки к Raph. */
export interface RuntimeHostLocalInputSource {
  kind: 'local'
  props: Record<string, unknown>
}

/** Binding входного prop на путь в Raph data storage. */
export interface RuntimeHostRaphInputBinding {
  path: string
  wildcardDynamic?: boolean
}

/** Raph-backed input source runtime-host-а. */
export interface RuntimeHostRaphInputSource {
  kind: 'raph'
  bindings: Record<string, RuntimeHostRaphInputBinding>
  /** Literal props, которые объединяются с Raph bindings. */
  props?: Record<string, unknown>
}

/** Унифицированный источник входных данных runtime-host-а. */
export type RuntimeHostInputSource
  = | RuntimeHostLocalInputSource
    | RuntimeHostRaphInputSource

/** Группа dirty-ноды, агрегированная к runtime boundary. */
export interface RuntimeDirtyBoundary {
  boundary: RaphNode
  dirtyNodes: RaphNode[]
  events: PhaseEvent[]
}

/** Контекст универсального runtime update, который получает root runtime-host. */
export interface RuntimeHostUpdateContext {
  node: RaphNode
  events: PhaseEvent[]
  boundaries: RuntimeDirtyBoundary[]
  frame: RaphFrameContext
}

/** Проекция patchable collection boundary, которую можно обновить точечно. */
export interface RuntimeCollectionProjectionPatch {
  /** Boundary-id дочерней проекции, например колонки таблицы. */
  boundaryId: string

  /** Семантический ключ проекции, например key колонки. */
  key: string

  /** Индекс проекции в render target, например индекс колонки. */
  index: number
}

/** Patch обновления части коллекции внутри runtime boundary. */
export interface RuntimeCollectionProjectionUpdatePatch {
  /** Тип patch payload. */
  kind: 'collection-projection-update'

  /** Boundary-id владельца коллекции, например Table. */
  boundaryId: string

  /** Тип boundary владельца коллекции. */
  boundaryType: 'table'

  /** Source path, на который подписана boundary-нода. */
  sourcePath: string

  /** Индекс элемента коллекции, если его можно извлечь из Raph event path. */
  itemIndex: number | null

  /** Ключ элемента коллекции, если runtime смог его прочитать. */
  itemKey: unknown

  /** Снимок элемента коллекции после изменения. */
  itemSnapshot: unknown

  /** Измененные относительные paths внутри элемента коллекции. */
  changedPaths: string[][]

  /** Проекции, которые зависят от измененных paths. */
  affectedProjections: RuntimeCollectionProjectionPatch[]

  /** Исходные события Raph, из которых собран patch. */
  events: PhaseEvent[]

  /** Raph-нода, которая стала верхней dirty boundary. */
  node: RaphNode
}

/** Нейтральный patch runtime boundary для render adapter-а. */
export type RuntimeBoundaryPatch = RuntimeCollectionProjectionUpdatePatch

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

  /** Runtime-scoped persistence controller, если host запущен с persistence. */
  readonly runtimeState: RuntimeStateControllerLike | null

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

  /** Привязать runtime-scoped persistence controller. */
  attachRuntimeState: (runtimeState: RuntimeStateControllerLike | null) => void

  /** Обработать runtime update, пришедший из Raph boundary phase. */
  update: (ctx: RuntimeHostUpdateContext) => Promise<void> | void

  /** Сериализовать host в снимок для UI/диагностики. */
  snapshot: () => RuntimeHostSnapshot
}
