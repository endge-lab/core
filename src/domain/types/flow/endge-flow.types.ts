/**
 * Канонический тип шага внутри action-flow.
 * Описывает поведение шага на уровне UX/runtime, а не форму graph-node.
 */
export type ActionFlowStepKind = 'builtin' | 'action' | 'runtime' | 'flow-ref'

/**
 * Тип graph-node внутри action-flow.
 * Определяет, какой блок должен быть исполнен рантаймом flow.
 */
export type EndgeFlowNodeKind = 'start' | 'watch' | 'eventSubscribe' | 'delay' | 'timer' | 'intervalTimer' | 'action' | 'query' | 'runtimeAction' | 'switch' | 'forEach' | 'while' | 'parallel'

/**
 * Направление порта graph-node.
 */
export type EndgeFlowPortDirection = 'input' | 'output'

/**
 * Режим сериализации значения параметра node.
 */
export type EndgeFlowBindingMode = 'literal' | 'context' | 'block-output'

/**
 * Декларативная ссылка на значение, которое должно быть подставлено в параметр node.
 */
export interface EndgeFlowBinding {
  /** Способ получения значения. */
  mode: EndgeFlowBindingMode
  /** Буквальное значение для режима `literal`. */
  value?: unknown
  /** Путь внутри execution-state для режима `context`. */
  path?: string | null
  /** Источник значения в другом node для режима `block-output`. */
  nodeId?: string | null
  /** Порт источника значения в другом node. */
  portId?: string | null
}

/**
 * Сериализованные параметры graph-node.
 * В editor-слое сюда могут попадать как structured bindings, так и уже развернутые plain values.
 */
export type EndgeFlowNodeParams = Record<string, EndgeFlowBinding | unknown>

/**
 * Описание входного или выходного порта flow-блока.
 */
export interface EndgeFlowPortDefinition {
  /** Уникальный идентификатор порта внутри блока. */
  id: string
  /** Название порта для UI и debug. */
  label: string
  /** Направление порта. */
  direction: EndgeFlowPortDirection
  /** Может ли порт иметь несколько подключений одновременно. */
  multiple?: boolean
  /** Обязателен ли порт для корректного исполнения блока. */
  required?: boolean
  /** Человекочитаемый тип значения, проходящего через порт. */
  valueType?: string | null
}

/**
 * Описание graph-node внутри action-flow definition.
 */
export interface EndgeFlowNodeDefinition {
  /** Уникальный идентификатор node внутри flow. */
  id: string
  /** Название шага для UI и debug. */
  title: string
  /** Идентификатор block-spec, который должен быть исполнен. */
  blockId: string
  /** Технический вид node в графе. */
  kind: EndgeFlowNodeKind
  /** Параметры node в сериализованном виде. */
  params?: EndgeFlowNodeParams
  /** Свободные метаданные node для editor/runtime. */
  meta?: Record<string, unknown>
}

/**
 * Описание связи между двумя node в action-flow.
 */
export interface EndgeFlowEdgeDefinition {
  /** Уникальный идентификатор ребра. */
  id: string
  /** Node-источник. Для входа в граф допускается ссылка на entrypoint. */
  sourceNodeId: string
  /** Порт источника. */
  sourcePortId: string
  /** Node-получатель. */
  targetNodeId: string
  /** Порт получателя. */
  targetPortId: string
  /** Пользовательская подпись ребра. */
  label?: string | null
}

/**
 * Каноническое декларативное описание action как flow-графа.
 */
export interface EndgeFlowDefinition {
  /** Версия формата сериализации flow. */
  version: number
  /** Идентификатор стартовой точки графа. Каноническое значение: `flow-entry`. */
  entrypoint: string
  /** Список node action-flow. */
  nodes: EndgeFlowNodeDefinition[]
  /** Список ориентированных связей между node. */
  edges: EndgeFlowEdgeDefinition[]
}

/**
 * Контракт action-definition в формате flow.
 * Отдельные alias добавлены для ясности в action-контексте.
 */
export type ActionFlowNodeKind = EndgeFlowNodeKind
export type ActionFlowNodeDefinition = EndgeFlowNodeDefinition
export type ActionFlowEdgeDefinition = EndgeFlowEdgeDefinition
export type ActionFlowDefinition = EndgeFlowDefinition
