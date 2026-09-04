import type { RComponentContract, RComponentDependencies } from '@/features/core/modules/domain/types/component/component-core.types'
import type { RComponentSFC_AST } from '@/features/core/modules/domain/types/component/sfc/ast.types'
import type { RComponentSFC_RuntimeDependencies } from '@/features/core/modules/domain/types/component/sfc/dependencies.types'
import type { RComponentSFC_IR } from '@/features/core/modules/domain/types/component/sfc/ir.types'
import type { RComponentSFCSource_Parts } from '@/features/core/modules/domain/types/component/sfc/source.types'
import type { ComputationProgramPayload } from '@/features/core/modules/domain/types/computation/computation-program.types'
import type { ProgramMetadata } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type {
  DataViewManualTransform,
  DataViewPipelineStep,
  DataViewRef,
  DataViewSourceDocument,
} from '@/features/core/modules/source/domain/types/data-view-source.types'
import type { ResponseOutputTransform } from '@/features/core/modules/source/domain/types/response-output.types'
import type { QueryProgramProp, SourceExpressionIR, SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { VocabProgramPayload } from '@/features/core/modules/source/domain/types/vocab-source.types'
import type { EndgeStyleSheetArtifact } from '@/features/core/modules/styles/domain/types/style.types'

export type { ActionProgramPayload } from '@/features/core/modules/program/domain/types/action-program.types'
export type { ConfigurationProgramPayload } from '@/features/core/modules/source/domain/types/configuration-source.types'

export type ProgramArtifactKey = string

/** Тип доменной сущности, для которой compiler может построить program artifact. */
export type ProgramEntityType
  = 'type'
    | 'component-sfc'
    | 'computation'
    | 'action'
    | 'query'
    | 'vocab'
    | 'data-view'
    | 'store'
    | 'stream'
    | 'update'
    | 'filter'
    | 'composition'
    | 'style'
    | 'configuration'

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

  /** Необязательное местоположение в Source ссылки на зависимость для диагностики linker. */
  sourcePath?: string
  start?: number
  end?: number
}

/** Единица compiled program: результат компиляции одной доменной сущности. */
export interface ProgramArtifact<TPayload = unknown> {
  /** Ссылка на исходную доменную сущность и ключ artifact в program. */
  ref: ProgramArtifactRef

  /** Hash стабильного source-снимка, по которому можно понять, менялся ли artifact input. */
  sourceHash: string

  /** Версия compiler pipeline, построившая artifact. */
  compilerVersion: string

  /** Hash structural context и effective configuration этой сборки. */
  contextHash?: string

  /** Итоговый статус artifact с учетом diagnostics. */
  status: ProgramArtifactStatus

  /** Список diagnostics, привязанных к artifact. */
  diagnostics: ProgramDiagnostic[]

  /** Список зависимостей, найденных compiler-ом. */
  dependencies: ProgramDependency[]

  /** Возможности artifact для runtime/render/query слоев. */
  capabilities: ProgramCapability[]

  /** Публичная compiler-derived metadata сущности и её внутренних узлов. */
  metadata: ProgramMetadata

  /** Typed payload конкретного artifact: SFC IR, compiled flow, query plan и т.п. */
  payload: TPayload

  /** Локальные compiled artifacts, принадлежащие только этому artifact. */
  children?: ProgramArtifact[]
}

export type QueryProgramOutputSource
  = | {
    type: 'response'
    path: string | null
    expression?: import('@/features/core/modules/source/domain/types/source-expression.types').SourceExpressionIR
  }
  | {
    type: 'output'
    key: string
  }

export interface QueryProgramOutput {
  key: string
  source: QueryProgramOutputSource
  /** Упорядоченная цепочка transform для новых runtimes. */
  transforms?: ResponseOutputTransform[]
  /** Проекция совместимости для runtimes, скомпилированных до упорядоченных transforms. */
  dataViews: DataViewRef[]
  contract?: SourceFieldDefinition | null
  materialization:
    | { kind: 'source' }
    | { kind: 'derived', strategy: import('@/features/core/modules/source/domain/types/data-view-source.types').DataViewMaterializationStrategy }
}

/** Статическое значение для обратной совместимости или скомпилированное выражение runtime-запроса. */
export type QueryProgramRequestValue<T> = T | SourceExpressionIR

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
  method?: QueryProgramRequestValue<string>

  /** Endpoint или базовая ссылка источника данных. */
  endpoint: QueryProgramRequestValue<string>

  /** Тело запроса, GraphQL document или custom query expression. */
  query: QueryProgramRequestValue<string>

  /** GraphQL operation name, если artifact использует query-gql transport. */
  operationName?: string

  /** Политика GraphQL errors в HTTP 2xx response. */
  errorPolicy?: 'throw' | 'ignore'

  /** HTTP-заголовки транспорта Query. */
  headers?: QueryProgramRequestValue<Record<string, string>>

  /** Auth config, подготовленный для runtime query layer. */
  auth?: QueryProgramRequestValue<unknown>

  /** Request timeout для REST query. */
  timeoutMs?: QueryProgramRequestValue<number>

  /** Отправлять body как application/x-www-form-urlencoded. */
  sendAsFormUrlencoded?: QueryProgramRequestValue<boolean>

  /** Единственный runtime input contract Query. */
  props: QueryProgramProp[]

  /** Безопасный request.body IR. При null отправляется пустой object payload. */
  requestBody: SourceExpressionIR | null

  /** Безопасный GraphQL variables IR. */
  requestVariables?: SourceExpressionIR | null

  /** Включены ли mock data для query. */
  mockDataEnabled?: boolean

  /** Query с mock-payload. */
  mockData?: unknown

  /** Ordered output graph, который runtime вычисляет после backend response. */
  outputs: QueryProgramOutput[]
}

export type { VocabProgramPayload }

/** Payload artifact для DataView: executable read-model без persisted runtime state. */
export interface DataViewProgramPayload {
  /** Тип artifact для diagnostics/debug UI. */
  type: 'data-view'

  /** Режим выполнения source: manual transform, pipeline, object projection или root expression. */
  mode: 'manual' | 'pipeline' | 'projection' | 'expression'

  /** Runtime-ready strategy; auto всегда разрешен compiler-ом заранее. */
  materializationStrategy: import('@/features/core/modules/source/domain/types/data-view-source.types').DataViewMaterializationStrategy

  /** Canonical source document для debug/preview UI. */
  sourceDocument: DataViewSourceDocument | null

  /** Декларативный входной и выходной тип DataView. */
  contract?: DataViewSourceDocument['contract']

  /** Контракт внешних параметров одного materialized DataView instance. */
  props?: SourceFieldDefinition[]

  /** Row-local predicate, применяемый после pipeline steps. */
  filter?: SourceExpressionIR | null

  /** Compiled manual transform. Используется только в mode=manual. */
  transform: DataViewManualTransform | null

  /** Compiled pipeline steps. Используется только в mode=pipeline. */
  steps: DataViewPipelineStep[]

  /** Compiled object fields. Используется только в mode=projection. */
  output: Record<string, SourceExpressionIR>

  /** Compiled root expression. Используется только в mode=expression. */
  expression?: SourceExpressionIR | null
}

/** Payload artifact для нового source-first SFC компонента. */
export interface ComponentSFCProgramPayload {
  /** Независимый статус компилятора для каждой секции SFC. */
  sections?: Record<'script' | 'template' | 'style', ProgramArtifactStatus>
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

  /** Runtime-параметры только для preview: заполнение локального store, запуск queries/actions и прочее. */
  previewOptions: ComponentSFCPreviewOptions | null

  /** Parser-level AST SFC source, нужен для diagnostics и debug UI. */
  ast: RComponentSFC_AST | null

  /** Target-neutral semantic IR, который renderer-слои используют для DOM/Nova. */
  ir: RComponentSFC_IR | null
}

/** Source-first документ стилей в payload runtime. */
export interface EndgeStyleProgramPayload {
  /** Скомпилированная таблица стилей, нейтральная к renderer. */
  stylesheet: EndgeStyleSheetArtifact

  /** ID тем, предоставляемые этим документом. */
  themes: string[]

  /** Внешние зависимости, найденные при компиляции условий стилей. */
  dependencies: ProgramDependency[]
}

export type { ComputationProgramPayload }

/** Одна запись build-derived registry пользовательских SFC tags. */
export interface ComponentSFCTagRegistryEntry {
  /** Пользовательский tag, доступный в template. */
  tag: string

  /** Identity persisted SFC-компонента, на который разрешается tag. */
  identity: string
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

export interface ComponentSFCPreviewDataProp {
  type: 'data'
  store: string
  path: string
}

export type ComponentSFCPreviewPropValue
  = | ComponentSFCPreviewLiteral
    | ComponentSFCPreviewStoreProp
    | ComponentSFCPreviewDataProp

export type ComponentSFCPreviewProps = Record<string, ComponentSFCPreviewPropValue>

export interface ComponentSFCPreviewRunTarget {
  type: 'query'
  identity: string
  storeTo?: {
    store: string
    fields: Record<string, string>
  }
}

export interface ComponentSFCPreviewOptions {
  seed?: Record<string, ComponentSFCPreviewLiteral>
  run?: ComponentSFCPreviewRunTarget[]
}

/** Контекст одного запуска compiler pipeline. */
export interface ProgramCompileContext {
  /** Версия compiler pipeline, которая попадет во все artifacts текущей сборки. */
  compilerVersion: string

  /** Неизменяемый структурный контекст и фактическая конфигурация этой сборки. */
  buildContext: import('@/features/core/modules/configuration/domain/types/configuration.type').EndgeBuildContext
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

    /** Исходный входной артефакт для hash. */
    sourceHash: string

    /** Версия compiler, построившая artifact. */
    compilerVersion: string
  }>
}
