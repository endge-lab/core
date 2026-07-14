import type { ActionRuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'
import type { FlowExecutionState } from '@/domain/types/flow/endge-flow-runtime.types'
import type { ActionFlowDefinition } from '@/domain/types/flow/endge-flow.types'

/**
 * Каноническое определение action как flow-графа.
 */
export type ActionDefinition = ActionFlowDefinition

/**
 * Контекст, который получают custom handlers и runtime-step handlers action-flow.
 */
export interface FlowHandlerContext {
  /** Каноническое runtime-state текущего запуска flow. */
  state: FlowExecutionState

  /** Идентификатор node внутри flow, если handler вызван из конкретного шага. */
  nodeId?: string | null

  /** Идентификатор block-spec исполненного шага. */
  blockId?: string | null

  /** Identity или id action, с которым связан текущий handler-вызов. */
  actionId?: string | null

  /** runtime-id host или runtime-step, если он известен во время вызова. */
  runtimeId?: string | null
}

/**
 * Результат работы custom/step handler.
 */
export type FlowHandlerResult = void | Promise<void>

/**
 * Сигнатура обработчика шага runtime-action: получает полный контекст host'а (input, parent, flowState и т.д.),
 * сам извлекает вход из context.input; опционально — flowContext (nodeId, state шага).
 */
export type ActionStepHandler = (
  context: ActionRuntimeHostContext,
  flowContext?: FlowHandlerContext,
) => FlowHandlerResult

/**
 * Проблема, найденная при валидации или исполнении action-flow.
 */
export interface FlowValidationIssue {
  /** Машинно-стабильный код проблемы. */
  code: string

  /** Человекочитаемое описание проблемы. */
  message: string

  /** Идентификатор node, если проблема относится к конкретному шагу. */
  nodeId?: string

  /** Идентификатор edge, если проблема относится к конкретной связи. */
  edgeId?: string
}

/**
 * Скомпилированное action-flow definition с индексами для быстрого исполнения.
 */
export interface ActionCompiledFlow {
  /** Нормализованное flow-описание action. */
  flow: ActionFlowDefinition

  /** Индекс node по id. */
  nodesById: Map<string, ActionFlowDefinition['nodes'][number]>

  /** Индекс первого node-id по blockId. */
  nodeIdByBlockId: Map<string, string>

  /** Индекс исходящих ребер по source node id. */
  outgoingByNodeId: Map<string, ActionFlowDefinition['edges']>

  /** Индекс входящих ребер по target node id (для передачи данных с портов). */
  incomingByNodeId: Map<string, ActionFlowDefinition['edges']>

  /** Индекс runtime-step по runtime-id. */
  runtimeNodeIdByRuntimeId: Map<string, string>

  /** Список достижимых node от entrypoint. */
  reachableNodeIds: string[]

  /** Validation issues, найденные во время компиляции. */
  issues: FlowValidationIssue[]
}
