import type {
  EndgeFlowDefinition,
  EndgeFlowNodeDefinition,
} from '@/domain/types/flow/endge-flow.types'

import { Expose, Type } from 'class-transformer'

class REndgeFlowNode {
  @Expose()
  id: string = ''

  @Expose()
  title: string = ''

  @Expose()
  blockId: string = ''

  @Expose()
  kind: EndgeFlowNodeDefinition['kind'] = 'action'

  @Expose()
  params: Record<string, unknown> = {}

  @Expose()
  meta: Record<string, unknown> = {}
}

class REndgeFlowEdge {
  @Expose()
  id: string = ''

  @Expose()
  sourceNodeId: string = ''

  @Expose()
  sourcePortId: string = ''

  @Expose()
  targetNodeId: string = ''

  @Expose()
  targetPortId: string = ''

  @Expose()
  label: string | null = null
}

export class REndgeFlow {
  @Expose()
  version: number = 1

  @Expose()
  entrypoint: string = 'flow-entry'

  @Expose()
  @Type(() => REndgeFlowNode)
  nodes: REndgeFlowNode[] = []

  @Expose()
  @Type(() => REndgeFlowEdge)
  edges: REndgeFlowEdge[] = []

  static createDefault(): REndgeFlow {
    return REndgeFlow.fromPlain({
      version: 1,
      entrypoint: 'flow-entry',
      nodes: [],
      edges: [],
    })
  }

  static fromPlain(json: Partial<EndgeFlowDefinition>): REndgeFlow {
    const flow = new REndgeFlow()
    flow.version = Number(json.version ?? 1) || 1
    const entrypoint = String(json.entrypoint ?? 'flow-entry').trim() || 'flow-entry'
    flow.entrypoint = entrypoint === 'start' ? 'flow-entry' : entrypoint
    flow.nodes = Array.isArray(json.nodes)
      ? json.nodes.map((node) => {
          const item = new REndgeFlowNode()
          item.id = String(node.id ?? '').trim()
          item.title = String(node.title ?? '').trim()
          item.blockId = String(node.blockId ?? '').trim()
          item.kind = node.kind ?? 'action'
          item.params = node.params && typeof node.params === 'object' && !Array.isArray(node.params)
            ? { ...node.params }
            : {}
          item.meta = node.meta && typeof node.meta === 'object' && !Array.isArray(node.meta)
            ? { ...node.meta }
            : {}
          return item
        })
      : []
    flow.edges = Array.isArray(json.edges)
      ? json.edges.map((edge) => {
          const item = new REndgeFlowEdge()
          item.id = String(edge.id ?? '').trim()
          item.sourceNodeId = String(edge.sourceNodeId ?? '').trim()
          item.sourcePortId = String(edge.sourcePortId ?? '').trim()
          item.targetNodeId = String(edge.targetNodeId ?? '').trim()
          item.targetPortId = String(edge.targetPortId ?? '').trim()
          item.label = edge.label != null ? String(edge.label) : null
          return item
        })
      : []
    return flow
  }

  toPlain(): EndgeFlowDefinition {
    return {
      version: this.version,
      entrypoint: this.entrypoint,
      nodes: this.nodes.map(node => ({
        id: node.id,
        title: node.title,
        blockId: node.blockId,
        kind: node.kind,
        params: { ...node.params },
        meta: { ...node.meta },
      })),
      edges: this.edges.map(edge => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        sourcePortId: edge.sourcePortId,
        targetNodeId: edge.targetNodeId,
        targetPortId: edge.targetPortId,
        label: edge.label,
      })),
    }
  }
}
