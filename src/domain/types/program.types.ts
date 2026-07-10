import type { ActionCompiledFlow } from '@/domain/types/action.types'
import type { RComponentContract, RComponentDependencies } from '@/domain/types/component-core.types'
import type {
  DataViewManualTransform,
  DataViewPipelineStep,
  DataViewRef,
  DataViewSourceDocument,
} from '@/domain/types/data-view-source.types'
import type {
  RComponentSFC_AST,
  RComponentSFC_IR,
  RComponentSFC_RuntimeDependencies,
  RComponentSFCSource_Parts,
} from '@/domain/types/component-sfc.types'
import type { DependencyGraph } from '@/domain/entities/data/DependencyGraph'
import type { QueryProgramProp, SourceExpressionIR } from '@/domain/types/source-expression.types'

/** Тип доменной сущности, для которой compiler может построить program artifact. */
export type ProgramEntityType
  = 'type'
    | 'component'
    | 'table'
    | 'component-sfc'
    | 'action'
    | 'query'
    | 'data-view'
    | 'filter'
    | 'composition'

/** Итоговый статус artifact после компиляции и валидации. */
export type ProgramArtifactStatus = 'valid' | 'warning' | 'error'

/** Возможность, которую artifact предоставляет runtime/render слоям. */
export type ProgramCapability
  = 'compilable'
    | 'runnable'
    | 'executable'
    | 'renderable'
    | 'data-provider'
    | 'configuration'

/** Стабильная ссылка на compiled artifact внутри Endge.program. */
export interface ProgramArtifactRef {
  /** Тип доменной сущности, которой принадлежит artifact. */
  entityType: ProgramEntityType

  /** Persisted id доменной сущности или fallback id, если persisted id еще нет. */
  id: string | number

  /** Стабильная identity доменной сущности для поиска без привязки к database id. */
  identity: string
}

/** Диагностическое сообщение, полученное во время компиляции artifact. */
export interface ProgramDiagnostic {
  /** Уровень важности диагностического сообщения. */
  severity: 'info' | 'warning' | 'error'

  /** Машинный код диагностики для фильтрации, тестов и UI-группировки. */
  code: string

  /** Человекочитаемое описание проблемы или предупреждения. */
  message: string

  /** Artifact, к которому относится диагностика. Заполняется при добавлении в program. */
  entityRef?: ProgramArtifactRef

  /** Путь внутри source/model: например script, template, style или definition.nodes. */
  sourcePath?: string

  /** Абсолютный offset начала проблемного фрагмента в source. */
  start?: number

  /** Абсолютный offset конца проблемного фрагмента в source. */
  end?: number
}

/** Зависимость compiled artifact от другой доменной сущности или внешней capability. */
export interface ProgramDependency {
  /** Тип зависимой сущности. Может быть расширен строкой для внешних источников. */
  entityType: ProgramEntityType | string

  /** Id зависимой сущности, если он известен compiler-у. */
  id: string | number

  /** Identity зависимой сущности, если она известна compiler-у. */
  identity?: string

  /** Роль зависимости: child-component, renderer, data-source и т.п. */
  role?: string
}

/** Единица compiled program: результат компиляции одной доменной сущности. */
export interface ProgramArtifact<TPayload = unknown> {
  /** Ссылка на исходную доменную сущность и ключ artifact в program. */
  ref: ProgramArtifactRef

  /** Hash стабильного source-снимка, по которому можно понять, менялся ли artifact input. */
  sourceHash: string

  /** Версия compiler pipeline, построившая artifact. */
  compilerVersion: string

  /** Итоговый статус artifact с учетом diagnostics. */
  status: ProgramArtifactStatus

  /** Список diagnostics, привязанных к artifact. */
  diagnostics: ProgramDiagnostic[]

  /** Список зависимостей, найденных compiler-ом. */
  dependencies: ProgramDependency[]

  /** Возможности artifact для runtime/render/query слоев. */
  capabilities: ProgramCapability[]

  /** Typed payload конкретного artifact: SFC IR, compiled flow, query plan и т.п. */
  payload: TPayload

  /** Локальные compiled artifacts, принадлежащие только этому artifact. */
  children?: ProgramArtifact[]
}

/** Payload artifact для action: скомпилированный flow или null при ошибке компиляции. */
export interface ActionProgramPayload {
  /** Нормализованный action-flow с индексами и runtime-ready структурой. */
  compiledFlow: ActionCompiledFlow | null
}

export type QueryProgramOutputSource
  = | {
    type: 'response'
    path: string | null
  }
  | {
    type: 'output'
    key: string
  }

export interface QueryProgramOutputStoreTarget {
  mode: 'default' | 'custom' | 'prop'
  key?: string
  prop?: string
}

export interface QueryProgramOutput {
  key: string
  source: QueryProgramOutputSource
  dataViews: DataViewRef[]
  store: QueryProgramOutputStoreTarget | null
}

/** Payload artifact для query-сущности. */
export interface QueryProgramPayload {
  /** Версия source syntax, определяющая runtime contract. */
  sourceVersion: number

  /** Parser-level AST query source, нужен для diagnostics/debug UI. */
  ast?: unknown

  /** Canonical authoring-модель query source. */
  sourceDocument?: unknown

  /** Тип query: REST, GraphQL, custom или другой поддерживаемый источник. */
  type: string

  /** HTTP method для REST query. */
  method?: string

  /** Endpoint или базовая ссылка источника данных. */
  endpoint: string

  /** Тело запроса, GraphQL document или custom query expression. */
  query: string

  /** Заголовки REST query. */
  headers?: Record<string, string>

  /** Auth config, подготовленный для runtime query layer. */
  auth?: unknown

  /** Request timeout для REST query. */
  timeoutMs?: number

  /** Отправлять body как application/x-www-form-urlencoded. */
  sendAsFormUrlencoded?: boolean

  /** Единственный runtime input contract Query. */
  props: QueryProgramProp[]

  /** Безопасный request.body IR. При null отправляется пустой object payload. */
  requestBody: SourceExpressionIR | null

  /** Props, которые участвуют в вычислении store key и фиксируются при mount. */
  stableProps: string[]

  /** Включены ли mock data для query. */
  mockDataEnabled?: boolean

  /** Mock payload query. */
  mockData?: unknown

  /** Ordered output graph, который runtime вычисляет после backend response. */
  outputs: QueryProgramOutput[]
}

/** Payload artifact для DataView: executable read-model без persisted runtime state. */
export interface DataViewProgramPayload {
  /** Тип artifact для diagnostics/debug UI. */
  type: 'data-view'

  /** Режим выполнения source: manual transform или декларативный pipeline. */
  mode: 'manual' | 'pipeline'

  /** Canonical source document для debug/preview UI. */
  sourceDocument: DataViewSourceDocument | null

  /** Compiled manual transform. Используется только в mode=manual. */
  transform: DataViewManualTransform | null

  /** Compiled pipeline steps. Используется только в mode=pipeline. */
  steps: DataViewPipelineStep[]
}

/** Payload artifact для legacy component/table ветки. */
export interface ComponentProgramPayload {
  /** Dependency graph, построенный legacy component compiler-ом. */
  depGraph: DependencyGraph | null

  /** Legacy AST или parser output, если компонент его строит. */
  ast?: unknown

  /** Legacy map переменных к data paths. */
  varsPaths?: unknown

  /** Имена переменных, которые требуются template. */
  requiredVars?: unknown

  /** Имена функций, которые требуются template. */
  requiredFns?: unknown

  /** Нормализованные data paths, если они доступны после compile. */
  dataPaths?: unknown
}

/** Payload artifact для нового source-first SFC компонента. */
export interface ComponentSFCProgramPayload {
  /** Разложенный canonical source: script, template и style. */
  sourceParts: RComponentSFCSource_Parts

  /** Внешний контракт компонента: inputs, events, slots. */
  contract: RComponentContract

  /** Зависимости компонента: дочерние компоненты, data sources, actions, renderers. */
  dependencies: RComponentDependencies

  /** Runtime-зависимости SFC v1, по которым host подписывается на input source. */
  runtimeDependencies: RComponentSFC_RuntimeDependencies

  /** Preview-only props для песочницы/debug UI. Не являются runtime default props. */
  previewProps: ComponentSFCPreviewProps | null

  /** Preview-only runtime options: seed local store, run queries/actions etc. */
  previewOptions: ComponentSFCPreviewOptions | null

  /** Parser-level AST SFC source, нужен для diagnostics и debug UI. */
  ast: RComponentSFC_AST | null

  /** Target-neutral semantic IR, который renderer-слои используют для DOM/Nova. */
  ir: RComponentSFC_IR | null
}

export type ComponentSFCPreviewLiteral
  = | null
    | string
    | number
    | boolean
    | ComponentSFCPreviewLiteral[]
    | { [key: string]: ComponentSFCPreviewLiteral }

export interface ComponentSFCPreviewStoreProp {
  type: 'store'
  path: string
}

export type ComponentSFCPreviewPropValue
  = | ComponentSFCPreviewLiteral
    | ComponentSFCPreviewStoreProp

export type ComponentSFCPreviewProps = Record<string, ComponentSFCPreviewPropValue>

export interface ComponentSFCPreviewRunTarget {
  type: 'query'
  identity: string
}

export interface ComponentSFCPreviewOptions {
  seed?: Record<string, ComponentSFCPreviewLiteral>
  run?: ComponentSFCPreviewRunTarget[]
}

/** Контекст одного запуска compiler pipeline. */
export interface ProgramCompileContext {
  /** Версия compiler pipeline, которая попадет во все artifacts текущей сборки. */
  compilerVersion: string
}

/** Handler компиляции одного типа доменных сущностей. */
export interface EntityCompilerHandler<TEntity = unknown, TPayload = unknown> {
  /** Тип сущности, которую умеет компилировать handler. */
  entityType: ProgramEntityType

  /** Функция компиляции одной сущности в один typed artifact. */
  compile: (
    entity: TEntity,
    context: ProgramCompileContext,
  ) => ProgramArtifact<TPayload>
}

/** Сводный snapshot текущего Endge.program для diagnostics/debug UI. */
export interface EndgeProgramSnapshot {
  /** Unix timestamp создания snapshot. */
  generatedAt: number

  /** Общий статус program, агрегированный по всем artifacts. */
  status: ProgramArtifactStatus

  /** Версия compiler, которой была собрана текущая program. */
  compilerVersion: string

  /** Общее количество artifacts в program. */
  total: number

  /** Количество artifacts по статусам valid/warning/error. */
  byStatus: Record<ProgramArtifactStatus, number>

  /** Количество artifacts по типам доменных сущностей. */
  byEntityType: Record<string, number>

  /** Все diagnostics из всех artifacts. */
  diagnostics: ProgramDiagnostic[]

  /** Компактные сведения по каждому artifact без тяжелого payload. */
  artifacts: Array<{
    /** Ссылка на artifact. */
    ref: ProgramArtifactRef

    /** Итоговый статус artifact. */
    status: ProgramArtifactStatus

    /** Количество diagnostics у artifact. */
    diagnostics: number

    /** Количество зависимостей у artifact. */
    dependencies: number

    /** Возможности artifact. */
    capabilities: ProgramCapability[]

    /** Hash source input artifact. */
    sourceHash: string

    /** Версия compiler, построившая artifact. */
    compilerVersion: string
  }>
}
