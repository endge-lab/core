import type { RAction } from '@/domain/entities/reflect/RAction'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { ActionCompiledFlow, FlowHandlerContext, FlowValidationIssue } from '@/domain/types/flow/action.types'
import type { FlowExecutionResult, FlowExecutionState } from '@/domain/types/flow/endge-flow-runtime.types'
import type { FlowSwitchParams } from '@/domain/types/flow/flow-condition.types'
import type { EndgeFlowNodeDefinition } from '@/domain/types/flow/endge-flow.types'
import type { QueryProgramPayload } from '@/domain/types/program/program.types'
import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'

import { Endge } from '@/model/endge/kernel/endge'
import { EndgeFlowRegistry } from '@/model/endge/runtime/flow/endge-flow-registry'

/**
 * Модуль исполнения compiled flow для action runtime-host.
 */
export class EndgeFlow {
  public constructor(
    public readonly conditions = new EndgeFlowRegistry(),
  ) {}

  /*
   * Публичные операции
   */

  /**
   * Исполняет flow целиком внутри переданного action runtime-host.
   */
  async run(host: RuntimeHost<'action'>): Promise<void> {
    if (!host || host.kind !== 'action') {
      return
    }

    const action = host.model
    const rawInput = host.context.input
    const input =
      rawInput != null && typeof rawInput === 'object' && !Array.isArray(rawInput)
        ? { ...rawInput }
        : (rawInput !== undefined && rawInput !== null ? { input: rawInput } : {})
    const startedAt = new Date().toISOString()
    const state = host.context.flowState
    state.input = input
    state.steps = {}
    state.locals = {}
    state.globals = {}
    state.lastStep = null

    host.replaceContext({
      ...host.context,
      status: 'running',
      startedAt,
      updatedAt: startedAt,
      input,
      flowState: state,
      currentNodeId: null,
      callStack: [String(action.identity ?? action.id)],
      lastFlowResult: null,
    })

    const compiled = this._getCompiledFlow(action)
    if (!compiled) {
      const result = this._createErrorResult(
        'flow.compile.missing',
        `Action must be compiled before flow execution: ${String(action.identity ?? action.id ?? '')}`,
        state,
      )
      host.replaceContext({
        ...host.context,
        status: 'error',
        updatedAt: new Date().toISOString(),
        flowState: result.state,
        currentNodeId: null,
        callStack: [String(action.identity ?? action.id)],
        lastFlowResult: result,
      })
      return
    }

    const issues: FlowValidationIssue[] = [...compiled.issues]
    const visitedNodeIds: string[] = []
    const visited = new Set<string>()
    let currentEdge = (compiled.outgoingByNodeId.get(compiled.flow.entrypoint) ?? [])[0]
    let lastResult = this._createExecutionResult(true, state, issues)

    while (issues.length === 0 && currentEdge) {
      const nodeId = String(currentEdge.targetNodeId ?? '').trim()
      if (!nodeId || visited.has(nodeId)) {
        break
      }

      visited.add(nodeId)
      visitedNodeIds.push(nodeId)
      lastResult = await this.runBlock(host, nodeId)
      if (!lastResult.ok) {
        break
      }

      const nextNode = compiled.nodesById.get(nodeId)
      const outgoing = compiled.outgoingByNodeId.get(nodeId) ?? []
      if (nextNode?.blockId === 'core.switch' && outgoing.length > 0) {
        const selectedPortId = await this._getSwitchSelectedPortId(host, nextNode, state)
        const nextEdge = outgoing.find(e => String(e.sourcePortId) === selectedPortId)
          ?? outgoing.find(e => String(e.sourcePortId) === 'else')
          ?? outgoing[0]
        currentEdge = nextEdge
      }
      else {
        currentEdge = outgoing[0]
      }
    }

    if (issues.length === 0 && lastResult.ok) {
      state.globals.execution = {
        mode: 'all',
        executedAt: new Date().toISOString(),
        visitedNodeIds,
      }
    }

    const result = this._createExecutionResult(issues.length === 0 && lastResult.ok, state, issues)
    host.replaceContext({
      ...host.context,
      status: result.ok ? 'success' : 'error',
      updatedAt: new Date().toISOString(),
      flowState: result.state,
      currentNodeId: String((result.state.lastStep as Record<string, unknown> | null)?.nodeId ?? '') || null,
      callStack: [String(action.identity ?? action.id)],
      lastFlowResult: result,
    })
  }

  /**
   * Исполняет один block внутри переданного action runtime-host.
   */
  async runBlock(host: RuntimeHost<'action'>, blockId: string): Promise<FlowExecutionResult> {
    if (!host || host.kind !== 'action') {
      return this._createErrorResult(
        'flow.runtime.invalid',
        'runBlock expects action runtime host',
      )
    }
    const nodeId = blockId
    if (!nodeId) {
      return this._createErrorResult(
        'flow.block.missing',
        'blockId is required',
        host.context.flowState,
      )
    }

    const action = host.model
    const compiled = this._getCompiledFlow(action)
    if (!compiled) {
      return this._createErrorResult(
        'flow.compile.missing',
        `Action must be compiled before flow execution: ${String(action.identity ?? action.id ?? '')}`,
        host.context.flowState,
      )
    }

    const targetNodeId = compiled.nodesById.has(nodeId)
      ? nodeId
      : (compiled.nodeIdByBlockId.get(nodeId) ?? null)
    const targetNode = targetNodeId ? (compiled.nodesById.get(targetNodeId) ?? null) : null

    const issues: FlowValidationIssue[] = [...compiled.issues]
    const state = host.context.flowState
    const executedAt = new Date().toISOString()

    if (!targetNode) {
      issues.push({
        code: 'flow.node.missing',
        message: `Flow node not found for block: ${nodeId}`,
        nodeId,
      })
    }

    if (issues.length === 0 && targetNode) {
      const node = targetNode
      const meta = node.meta && typeof node.meta === 'object' && !Array.isArray(node.meta)
        ? node.meta as Record<string, unknown>
        : {}
      const resolvedParams = this._resolveNodeParams(this._toPlainParams(node.params), state)
      const runtime = Endge.runtime.getRuntimeById<RAction>(host.id) as unknown as {
        emit: (event: string, payload: unknown) => void
      } | null

      runtime?.emit('step:start', {
        stepId: node.id,
        runtimeId: host.id,
        title: node.title,
        meta: {
          blockId: node.blockId,
          stepKind: String(meta.stepKind ?? '').trim() || null,
        },
      })

      let stepState: Record<string, unknown>
      let stepOutput: Record<string, unknown> | undefined
      try {
        if (node.blockId === 'core.action') {
          const actionIdRaw = String(meta.actionId ?? meta.runtimeId ?? '').trim()
          if (!actionIdRaw) {
            issues.push({
              code: 'flow.action.missing',
              message: `Action id is required for node: ${node.id}`,
              nodeId: node.id,
            })

            runtime?.emit('step:error', {
              stepId: node.id,
              runtimeId: host.id,
              title: node.title,
              error: 'actionId is missing',
              meta: {
                blockId: node.blockId,
                stepKind: String(meta.stepKind ?? '').trim() || null,
              },
            })
          }
          else {
            const actionIdAsNumber = Number(actionIdRaw)
            const actionId: string | number = Number.isFinite(actionIdAsNumber) ? actionIdAsNumber : actionIdRaw
            const targetAction = Endge.domain.getAction(actionId)
              ?? Endge.actions.getDefinition(actionIdRaw)
            if (!targetAction) {
              issues.push({
                code: 'flow.action.missing',
                message: `Nested action not found: ${actionIdRaw}`,
                nodeId: node.id,
              })
            }
            else {
              const paramsFromIncomingEdge = this._getParamsFromIncomingEdge(compiled, node.id, state)
              const mergedParams = { ...paramsFromIncomingEdge, ...resolvedParams }
              const payload = this._buildActionInput(mergedParams, targetAction)
              stepOutput = payload != null && typeof payload === 'object' && !Array.isArray(payload)
                ? { ...payload }
                : (payload != null ? { output: payload } : undefined)
              const nestedResult = await Endge.actions.execute<FlowExecutionResult>(targetAction.identity, {
                input: payload,
                context: { parentRuntimeId: host.id },
              })
              if (nestedResult && !nestedResult.ok) {
                for (const issue of nestedResult.issues) {
                  issues.push({
                    code: issue.code,
                    message: issue.message,
                    nodeId: issue.nodeId ?? node.id,
                    edgeId: issue.edgeId,
                  })
                }
              }
            }
          }
        }

        if (node.blockId === 'core.runtime-action') {
          const runtimeId = String(meta.runtimeId ?? meta.actionId ?? '').trim()
          if (!runtimeId) {
            issues.push({
              code: 'flow.runtime-action.missing',
              message: `Runtime id is required for node: ${node.id}`,
              nodeId: node.id,
            })

            runtime?.emit('step:error', {
              stepId: node.id,
              runtimeId: host.id,
              title: node.title,
              error: 'runtimeId is missing',
              meta: {
                blockId: node.blockId,
                stepKind: String(meta.stepKind ?? '').trim() || null,
              },
            })
          }
          else {
            const paramsFromIncomingEdge = this._getParamsFromIncomingEdge(compiled, node.id, state)
            const mergedParams = { ...paramsFromIncomingEdge, ...resolvedParams }
            const payload = this._buildActionInput(mergedParams, action)
            stepOutput = payload != null && typeof payload === 'object' && !Array.isArray(payload)
              ? { ...payload }
              : (payload != null ? { output: payload } : undefined)
            const runtimeContext = this._createFlowHandlerContext(node, state, {
              runtimeId,
              actionId: String(action.id ?? action.identity ?? '').trim() || null,
            })

            const handler = action.getStepHandler(runtimeId)
            if (handler) {
              const stepInput = payload != null && typeof payload === 'object' && !Array.isArray(payload)
                ? { ...(payload as Record<string, unknown>) }
                : payload
              const stepContext = { ...host.context, input: (stepInput ?? {}) as Record<string, unknown> }
              await Promise.resolve(handler(stepContext, runtimeContext))
            }
            else {
              issues.push({
                code: 'flow.runtime-action.unbound',
                message: `Runtime action is not bound: ${runtimeId}`,
                nodeId: node.id,
              })

              runtime?.emit('step:error', {
                stepId: node.id,
                runtimeId: host.id,
                title: node.title,
                error: `runtime action is not bound: ${runtimeId}`,
                meta: {
                  blockId: node.blockId,
                  stepKind: String(meta.stepKind ?? '').trim() || null,
                },
              })
            }
          }
        }

        if (node.blockId === 'core.query') {
          const queryIdRaw = String(meta.queryId ?? '').trim()
          if (!queryIdRaw) {
            issues.push({
              code: 'flow.query.missing',
              message: `Query id is required for node: ${node.id}`,
              nodeId: node.id,
            })

            runtime?.emit('step:error', {
              stepId: node.id,
              runtimeId: host.id,
              title: node.title,
              error: 'queryId is missing',
              meta: {
                blockId: node.blockId,
                stepKind: String(meta.stepKind ?? '').trim() || null,
              },
            })
          }
          else {
            const queryIdAsNumber = Number(queryIdRaw)
            const queryId: string | number = Number.isFinite(queryIdAsNumber) ? queryIdAsNumber : queryIdRaw
            const targetQuery = Endge.domain.getQuery(queryId)
            if (!targetQuery) {
              issues.push({
                code: 'flow.query.missing',
                message: `Query not found: ${queryIdRaw}`,
                nodeId: node.id,
              })
            }
            else {
              const paramsFromIncomingEdge = this._getParamsFromIncomingEdge(compiled, node.id, state)
              const mergedParams = { ...paramsFromIncomingEdge, ...resolvedParams }
              const queryInput = this._buildQueryInput(mergedParams, targetQuery)
              const result = await targetQuery.run(queryInput)
              stepOutput = result != null && typeof result === 'object' && !Array.isArray(result)
                ? { ...(result as Record<string, unknown>) }
                : (result != null ? { output: result } : undefined)
            }
          }
        }

        const hasNodeIssue = issues.some(issue => issue.nodeId === node.id)
        if (hasNodeIssue) {
          stepState = {
            status: 'error',
            title: node.title,
            blockId: node.blockId,
            params: resolvedParams,
            executedAt,
            error: issues.filter(issue => issue.nodeId === node.id).map(issue => issue.message).join('; '),
          }
        }
        else {
          runtime?.emit('step:success', {
            stepId: node.id,
            runtimeId: host.id,
            actionId: String(meta.actionId ?? '').trim() || null,
            title: node.title,
            meta: {
              blockId: node.blockId,
              stepKind: String(meta.stepKind ?? '').trim() || null,
            },
          })

          const stepOutputValue = stepOutput != null && Object.keys(stepOutput).length === 1 && 'output' in stepOutput
            ? stepOutput.output
            : stepOutput
          stepState = {
            status: 'success',
            title: node.title,
            blockId: node.blockId,
            params: resolvedParams,
            executedAt,
            ...(stepOutputValue != null && { output: stepOutputValue }),
          }
        }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        issues.push({
          code: 'flow.node.execution.failed',
          message,
          nodeId: node.id,
        })

        runtime?.emit('step:error', {
          stepId: node.id,
          runtimeId: host.id,
          actionId: String(meta.actionId ?? '').trim() || null,
          title: node.title,
          error,
          meta: {
            blockId: node.blockId,
            stepKind: String(meta.stepKind ?? '').trim() || null,
          },
        })

        stepState = {
          status: 'error',
          title: node.title,
          blockId: node.blockId,
          params: resolvedParams,
          executedAt,
          error: message,
        }
      }

      state.steps[node.id] = stepState
      state.lastStep = {
        nodeId: node.id,
        title: node.title,
        blockId: node.blockId,
        executedAt,
        status: stepState.status,
      }
      state.globals.execution = {
        mode: 'block',
        executedAt,
        nodeId: node.id,
      }
    }

    const result = this._createExecutionResult(issues.length === 0, state, issues)
    host.replaceContext({
      ...host.context,
      status: result.ok ? 'success' : 'error',
      updatedAt: executedAt,
      flowState: result.state,
      currentNodeId: targetNode?.id ?? null,
      callStack: [...(host.context.callStack ?? [])],
      lastFlowResult: result,
    })

    return result
  }

  /*
   * Внутренние операции
   */

  /** Создаёт пустой flow-state для случаев, когда состояние ещё не инициализировано. */
  /**
   * Создает Default State.
   */
  private _createDefaultState(input: Record<string, unknown> = {}): FlowExecutionState {
    const locals: Record<string, unknown> = {}
    return {
      input: { ...input },
      steps: {},
      locals,
      globals: {},
      lastStep: null,
    }
  }

  /** Формирует канонический результат выполнения flow/block. */
  /**
   * Создает Execution Result.
   */
  private _createExecutionResult(
    ok: boolean,
    state: FlowExecutionState,
    issues: FlowValidationIssue[],
  ): FlowExecutionResult {
    return {
      ok,
      state,
      issues,
    }
  }

  /** Преобразует параметры node в плоский объект значений для рантайма. */
  /**
   * Преобразует значение в Plain Params.
   */
  private _toPlainParams(params: EndgeFlowNodeDefinition['params']): Record<string, unknown> {
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(params).map(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
          return [key, (value as unknown as Record<string, unknown>).value]
        }
        return [key, value]
      }),
    )
  }

  /** Собирает error-результат с единым форматом issue. */
  /**
   * Создает Error Result.
   */
  private _createErrorResult(
    code: string,
    message: string,
    state?: FlowExecutionState,
  ): FlowExecutionResult {
    return this._createExecutionResult(false, state ?? this._createDefaultState(), [{ code, message }])
  }

  /**
   * Определяет порт switch по условию (скрипт или реестр).
   * Возвращает portId для выбора исходящего ребра.
   */
  private async _getSwitchSelectedPortId(
    host: RuntimeHost<'action'>,
    node: EndgeFlowNodeDefinition,
    state: FlowExecutionState,
  ): Promise<string> {
    const params = (this._toPlainParams(node.params) ?? {}) as FlowSwitchParams
    const mode = params.conditionMode ?? 'script'
    const elsePortId = 'else'

    if (mode === 'script') {
      // Произвольные script conditions больше не выполняются.
      return elsePortId
    }

    if (mode === 'registry' && Array.isArray(params.branches) && params.branches.length > 0) {
      const flowContext = this._createFlowHandlerContext(node, state, {
        actionId: String(host.model?.id ?? host.model?.identity ?? '').trim() || null,
        runtimeId: host.id,
      })
      for (const branch of params.branches) {
        const conditionId = branch?.conditionId
        const portId = branch?.portId
        if (!conditionId || !portId) continue
        const ok = await this.conditions.evaluateCondition(
          conditionId,
          flowContext,
          branch.params ?? {},
        )
        if (ok) return String(portId)
      }
      return elsePortId
    }

    return elsePortId
  }

  /**
   * Параметры, приходящие по входящему ребру на порт 'in':
   * если источник — entrypoint (flow-entry), берём state.input; иначе — выход предыдущего шага.
   */
  private _getParamsFromIncomingEdge(
    compiled: ActionCompiledFlow,
    nodeId: string,
    state: FlowExecutionState,
  ): Record<string, unknown> {
    const incoming = compiled.incomingByNodeId?.get(nodeId)
    if (!incoming?.length) return {}

    const entrypoint = String(compiled.flow.entrypoint ?? 'flow-entry').trim()
    const edgeToIn = incoming.find(
      e => String(e.targetPortId ?? 'in').trim() === 'in',
    )
    if (!edgeToIn) return {}

    const source = String(edgeToIn.sourceNodeId ?? '').trim()
    if (source === entrypoint) {
      const input = state.input
      if (input != null && typeof input === 'object' && !Array.isArray(input)) {
        return { ...input }
      }
      if (Array.isArray(input)) {
        return { input }
      }
      return {}
    }

    const stepOutput = state.steps[source] as Record<string, unknown> | undefined
    const output = stepOutput?.output
    if (output != null && typeof output === 'object' && !Array.isArray(output)) {
      return { ...output as Record<string, unknown> }
    }
    if (Array.isArray(output)) {
      return { input: output }
    }
    return {}
  }

  /**
   * Строит payload для action с учётом input-схемы.
   * Если params = { input: value } (единственный ключ "input"), передаём в action только value (массив и т.д.), без обёртки.
   */
  private _buildActionInput(
    resolvedParams: Record<string, unknown>,
    action: RAction | null,
  ): Record<string, unknown> | unknown {
    const keys = Object.keys(resolvedParams)
    const onlyInputKey = keys.length === 1 && Object.prototype.hasOwnProperty.call(resolvedParams, 'input')
    const unwrapped = onlyInputKey ? resolvedParams.input : null

    if (unwrapped !== null) {
      return unwrapped
    }

    if (action?.input) {
      const inputName = action.input.name
      if (inputName && Object.prototype.hasOwnProperty.call(resolvedParams, inputName)) {
        return { [inputName]: resolvedParams[inputName] }
      }

      const entries = Object.entries(resolvedParams)
      if (inputName && entries.length === 1) {
        return { [inputName]: entries[0][1] }
      }
    }

    return { ...resolvedParams }
  }

  /**
   * Подготавливает payload для query с учётом сигнатуры параметров.
   * Поддерживает сценарий, когда в flow передаётся только `input`, а у query объявлен единственный параметр.
   */
  private _buildQueryInput(
    resolvedParams: Record<string, unknown>,
    query: RQuery | null,
  ): Record<string, unknown> {
    const input = { ...resolvedParams }
    const artifactId = query?.id ?? query?.identity
    const artifact = artifactId != null
      ? Endge.program.getQueryArtifact(artifactId)
      : null
    const paramNames = this._getQueryArtifactParamNames(artifact?.payload ?? null)

    if (paramNames.length === 0) {
      return input
    }

    const hasDeclaredParams = paramNames.some(name => Object.prototype.hasOwnProperty.call(input, name))
    if (hasDeclaredParams) {
      return input
    }

    if (Object.keys(input).length === 1 && Object.prototype.hasOwnProperty.call(input, 'input') && paramNames.length === 1) {
      return { [paramNames[0]]: input.input }
    }

    if (Object.keys(input).length === 1 && paramNames.length === 1) {
      const firstValue = Object.values(input)[0]
      return { [paramNames[0]]: firstValue }
    }

    return input
  }

  /** Возвращает имена props, объявленных в Query artifact. */
  private _getQueryArtifactParamNames(payload: QueryProgramPayload | null): string[] {
    return (payload?.props ?? [])
      .map(prop => String(prop.key ?? '').trim())
      .filter(Boolean)
  }

  /** Формирует runtime-контекст, который передаётся в custom/runtime handlers. */
  /**
   * Создает Flow Handler Context.
   */
  private _createFlowHandlerContext(
    node: EndgeFlowNodeDefinition,
    state: FlowExecutionState,
    options: {
      actionId?: string | null
      runtimeId?: string | null
    },
  ): FlowHandlerContext {
    return {
      state,
      nodeId: node.id,
      blockId: node.blockId,
      actionId: options.actionId ?? null,
      runtimeId: options.runtimeId ?? null,
    }
  }

  /**
   * Возвращает Compiled Flow.
   */
  private _getCompiledFlow(action: RAction): ActionCompiledFlow | null {
    const actionId = action.id
    const actionIdentity = action.identity

    return Endge.program.getActionFlow(actionId)
      ?? (actionIdentity ? Endge.program.getActionFlow(actionIdentity) : null)
  }

  /** Рекурсивно резолвит параметры node через текущий flow-state. */
  /**
   * Разрешает Node Params.
   */
  private _resolveNodeParams(
    params: Record<string, unknown>,
    state: FlowExecutionState,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(params).map(([key, value]) => [key, this._resolveValue(value, state)]),
    )
  }

  /** Рекурсивно резолвит значение параметра: строки, массивы и объекты. */
  /**
   * Разрешает Value.
   */
  private _resolveValue(value: unknown, state: FlowExecutionState): unknown {
    if (typeof value === 'string') {
      return this._resolveStringValue(value, state)
    }

    if (Array.isArray(value)) {
      return value.map(item => this._resolveValue(item, state))
    }

    if (value != null && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [key, this._resolveValue(nestedValue, state)]),
      )
    }

    return value
  }

  /** Резолвит выражения вида `{ctx...}` в строках параметров node. */
  /**
   * Разрешает String Value.
   */
  private _resolveStringValue(value: string, state: FlowExecutionState): unknown {
    const text = String(value)
    const fullExpressionPath = this._extractFullContextPath(text)
    if (fullExpressionPath) {
      return this._getContextValue(fullExpressionPath, state)
    }

    return text.replace(/\{([^{}]+)\}/g, (_match, rawPath: string) => {
      const path = String(rawPath).trim()
      if (!path.startsWith('ctx')) {
        return _match
      }

      const resolved = this._getContextValue(path, state)
      if (resolved == null) {
        return ''
      }
      if (typeof resolved === 'string') {
        return resolved
      }
      return JSON.stringify(resolved)
    })
  }

  /** Достаёт значение из flow-state по пути `ctx.*`. */
  /**
   * Возвращает Context Value.
   */
  private _getContextValue(path: string, state: FlowExecutionState): unknown {
    const normalizedPath = String(path).trim()
    if (!normalizedPath.startsWith('ctx')) {
      return undefined
    }

    if (normalizedPath === 'ctx') {
      return state
    }

    const segments = normalizedPath.split('.').filter(Boolean)
    let cursor: unknown = state

    for (const segment of segments.slice(1)) {
      if (cursor == null || typeof cursor !== 'object' || Array.isArray(cursor)) {
        return undefined
      }
      cursor = (cursor as Record<string, unknown>)[segment]
    }

    return cursor
  }

  /** Проверяет, является ли строка полным выражением контекста (`{ctx...}`). */
  /**
   * Внутренний helper модуля: extract Full Context Path.
   */
  private _extractFullContextPath(text: string): string | null {
    if (!text.startsWith('{') || !text.endsWith('}')) {
      return null
    }

    const inner = text.slice(1, -1).trim()
    if (!inner.startsWith('ctx')) {
      return null
    }
    if (inner.includes('{') || inner.includes('}')) {
      return null
    }

    return inner
  }
}
