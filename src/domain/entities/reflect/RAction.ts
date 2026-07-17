import type { ActionCompiledFlow, ActionDefinition, ActionStepHandler, FlowValidationIssue } from '@/domain/types/flow/action.types'
import type { ActionFlowDefinition } from '@/domain/types/flow/endge-flow.types'

import { Serialize } from '@endge/utils'
import { Exclude, Expose, Type } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'
import { RField } from '@/domain/entities/reflect/RField'
import { Endge } from '@/model/endge/kernel/endge'

/**
 * Действие хранится как flow-описание.
 * Атомарное действие = flow из одного шага.
 */
export class RAction extends REntity {
  @Expose()
  definition: ActionDefinition = {
    version: 1,
    entrypoint: 'flow-entry',
    nodes: [],
    edges: [],
  }

  @Expose()
  @Type(() => RField)
  input: RField | null = null

  @Expose()
  @Type(() => RField)
  output: RField | null = null

  @Exclude()
  private readonly stepHandlers = new Map<string, ActionStepHandler>()

  @Exclude()
  private _compiledFlow: ActionCompiledFlow | null = null

  setStepHandler(runtimeId: string, fn: ActionStepHandler | undefined): void {
    const id = String(runtimeId).trim()
    if (!id) { return }

    if (!fn) {
      this.stepHandlers.delete(id)
      return
    }

    this.stepHandlers.set(id, fn)
  }

  getStepHandler(runtimeId: string): ActionStepHandler | undefined {
    return this.stepHandlers.get(String(runtimeId).trim())
  }

  hasStepHandler(runtimeId: string): boolean {
    return this.stepHandlers.has(String(runtimeId).trim())
  }

  clearStepHandlers(): void {
    this.stepHandlers.clear()
  }

  private _normalizeDefinition(rawDefinition: unknown): ActionFlowDefinition {
    const definition = rawDefinition != null && typeof rawDefinition === 'object' && !Array.isArray(rawDefinition)
      ? rawDefinition as Record<string, unknown>
      : {}
    const version = Number(definition.version ?? 1) || 1
    const nodesRaw = Array.isArray(definition.nodes) ? definition.nodes : []
    const edgesRaw = Array.isArray(definition.edges) ? definition.edges : []

    const nodes: ActionFlowDefinition['nodes'] = nodesRaw.map((rawNode, index) => {
      const node = rawNode != null && typeof rawNode === 'object' && !Array.isArray(rawNode)
        ? rawNode as Record<string, unknown>
        : {}
      const rawMeta = node.meta != null && typeof node.meta === 'object' && !Array.isArray(node.meta)
        ? node.meta as Record<string, unknown>
        : {}
      const meta: Record<string, unknown> = { ...rawMeta }
      const rawKind = String(node.kind ?? '').trim()
      const rawBlockId = String(node.blockId ?? '').trim()
      const stepKind = String(meta.stepKind ?? '').trim()

      const kind = rawKind
        || (rawBlockId === 'core.query'
          ? 'query'
          : (stepKind === 'runtime' ? 'runtimeAction' : (rawBlockId === 'core.runtime-action' ? 'runtimeAction' : 'action')))
      const normalizedBlockId = rawBlockId || (kind === 'runtimeAction' ? 'core.runtime-action' : (kind === 'query' ? 'core.query' : 'core.action'))
      const runtimeId = String(meta.runtimeId ?? meta.actionId ?? '').trim()
      if (kind === 'runtimeAction' || normalizedBlockId === 'core.runtime-action') {
        if (runtimeId) { meta.runtimeId = runtimeId }
        meta.stepKind = 'runtime'
      }

      if ((kind === 'action' || normalizedBlockId === 'core.action') && meta.actionId == null && meta.runtimeId != null) {
        const actionId = String(meta.runtimeId).trim()
        if (actionId) { meta.actionId = actionId }
      }

      return {
        id: String(node.id ?? '').trim() || `node-${index + 1}`,
        title: String(node.title ?? node.name ?? '').trim() || `Step ${index + 1}`,
        blockId: normalizedBlockId,
        kind: kind as ActionFlowDefinition['nodes'][number]['kind'],
        params: (
          node.params != null && typeof node.params === 'object' && !Array.isArray(node.params)
            ? { ...(node.params as Record<string, unknown>) }
            : {}
        ) as ActionFlowDefinition['nodes'][number]['params'],
        meta,
      }
    })

    const edges: ActionFlowDefinition['edges'] = []
    edgesRaw.forEach((rawEdge, index) => {
      const edge = rawEdge != null && typeof rawEdge === 'object' && !Array.isArray(rawEdge)
        ? rawEdge as Record<string, unknown>
        : {}
      const sourceNodeId = String(edge.sourceNodeId ?? edge.source ?? '').trim()
      const targetNodeId = String(edge.targetNodeId ?? edge.target ?? '').trim()
      if (!sourceNodeId || !targetNodeId) {
        return
      }

      edges.push({
        id: String(edge.id ?? '').trim() || `edge-${index + 1}-${sourceNodeId}-${targetNodeId}`,
        sourceNodeId,
        sourcePortId: String(edge.sourcePortId ?? edge.sourceHandle ?? 'out').trim() || 'out',
        targetNodeId,
        targetPortId: String(edge.targetPortId ?? edge.targetHandle ?? 'in').trim() || 'in',
        label: edge.label != null ? String(edge.label) : null,
      })
    })

    let entrypoint = String(definition.entrypoint ?? 'flow-entry').trim() || 'flow-entry'
    if (
      entrypoint === 'start'
      && !edges.some(edge => edge.sourceNodeId === 'start')
      && edges.some(edge => edge.sourceNodeId === 'flow-entry')
    ) {
      entrypoint = 'flow-entry'
    }

    return {
      version,
      entrypoint,
      nodes,
      edges,
    }
  }

  private _buildCompiledFlow(flow: ActionFlowDefinition): ActionCompiledFlow {
    const nodesById = new Map<string, ActionFlowDefinition['nodes'][number]>()
    const nodeIdByBlockId = new Map<string, string>()
    const outgoingByNodeId = new Map<string, ActionFlowDefinition['edges']>()
    const runtimeNodeIdByRuntimeId = new Map<string, string>()

    for (const node of flow.nodes) {
      nodesById.set(node.id, node)
      const blockId = String(node.blockId ?? '').trim()
      if (blockId && !nodeIdByBlockId.has(blockId)) {
        nodeIdByBlockId.set(blockId, node.id)
      }
      const meta = node.meta != null && typeof node.meta === 'object' && !Array.isArray(node.meta)
        ? node.meta as Record<string, unknown>
        : {}
      const stepKind = String(meta.stepKind ?? '').trim()
      const rawRuntimeId = String(meta.runtimeId ?? meta.actionId ?? '').trim()
      const isRuntimeNode = node.kind === 'runtimeAction' || stepKind === 'runtime' || String(node.blockId ?? '').trim() === 'core.runtime-action'
      if (isRuntimeNode && rawRuntimeId) { runtimeNodeIdByRuntimeId.set(rawRuntimeId, node.id) }
    }

    const incomingByNodeId = new Map<string, ActionFlowDefinition['edges']>()
    for (const edge of flow.edges) {
      const source = String(edge.sourceNodeId ?? '').trim()
      if (!source) { continue }
      outgoingByNodeId.set(source, [...(outgoingByNodeId.get(source) ?? []), edge])
      const target = String(edge.targetNodeId ?? '').trim()
      if (target) {
        incomingByNodeId.set(target, [...(incomingByNodeId.get(target) ?? []), edge])
      }
    }

    const reachableNodeIds: string[] = []
    const visited = new Set<string>()
    const queue: string[] = (outgoingByNodeId.get(flow.entrypoint) ?? [])
      .map(edge => String(edge.targetNodeId ?? '').trim())
      .filter(Boolean)

    while (queue.length > 0) {
      const nodeId = String(queue.shift() ?? '').trim()
      if (!nodeId || visited.has(nodeId)) { continue }
      visited.add(nodeId)
      reachableNodeIds.push(nodeId)
      for (const edge of outgoingByNodeId.get(nodeId) ?? []) {
        const nextId = String(edge.targetNodeId ?? '').trim()
        if (nextId && !visited.has(nextId)) { queue.push(nextId) }
      }
    }

    return {
      flow,
      nodesById,
      nodeIdByBlockId,
      outgoingByNodeId,
      incomingByNodeId,
      runtimeNodeIdByRuntimeId,
      reachableNodeIds,
      issues: this._validateFlow(flow),
    }
  }

  private _validateFlow(flow: ActionFlowDefinition): FlowValidationIssue[] {
    const issues: FlowValidationIssue[] = []
    const nodeIds = new Set(flow.nodes.map(node => node.id))

    if (!String(flow.entrypoint ?? '').trim()) {
      issues.push({
        code: 'flow.entrypoint.required',
        message: 'Flow must define entrypoint',
      })
    }

    for (const edge of flow.edges) {
      if (!nodeIds.has(edge.sourceNodeId) && edge.sourceNodeId !== flow.entrypoint) {
        issues.push({
          code: 'flow.edge.source.missing',
          message: `Edge source node not found: ${edge.sourceNodeId}`,
          edgeId: edge.id,
        })
      }
      if (!nodeIds.has(edge.targetNodeId)) {
        issues.push({
          code: 'flow.edge.target.missing',
          message: `Edge target node not found: ${edge.targetNodeId}`,
          edgeId: edge.id,
        })
      }
    }

    return issues
  }

  private _fieldToPlain(field: RField | null): Record<string, unknown> | null {
    if (!field) { return null }

    return {
      name: field.name,
      type: field.type,
      isArray: field.isArray === true,
      optional: field.optional === true,
    }
  }

  get compiledFlow(): ActionCompiledFlow | null {
    return this._compiledFlow
  }

  getValidationIssues(): FlowValidationIssue[] {
    return this._compiledFlow?.issues ? [...this._compiledFlow.issues] : []
  }

  validate(): FlowValidationIssue[] {
    this.compile()
    return this.getValidationIssues()
  }

  getCompiledRuntimeNodeId(runtimeId: string): string | null {
    const id = String(runtimeId).trim()
    if (!id) { return null }
    return this._compiledFlow?.runtimeNodeIdByRuntimeId.get(id) ?? null
  }

  override compile(): void {
    super.compile()
    const normalized = this._normalizeDefinition(this.definition)
    this.definition = {
      version: normalized.version,
      entrypoint: normalized.entrypoint,
      nodes: [...normalized.nodes],
      edges: [...normalized.edges],
    }
    this._compiledFlow = this._buildCompiledFlow(normalized)
  }

  run(): void {
    const runtime = Endge.runtime.execute(this, {})
    if (!runtime || runtime.kind !== 'action') { return }
    Endge.runtime.flow.run(runtime)
  }

  toPlain(): Record<string, unknown> {
    const rawDefinition = this.definition && typeof this.definition === 'object'
      ? { ...(this.definition as unknown as Record<string, unknown>) }
      : { version: 1, entrypoint: 'flow-entry', nodes: [], edges: [] }

    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName ?? this.name,
      description: this.description ?? null,
      folderId: this.folderId ?? null,
      definition: rawDefinition,
      input: this._fieldToPlain(this.input),
      output: this._fieldToPlain(this.output),
    }
  }

  override duplicate(options: DuplicateOptions): RAction {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RAction, plain)
  }
}
