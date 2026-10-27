import type {
  EndgeUIChildEntry,
  EndgeUIJsonSnapshot,
  EndgeUINode,
  EndgeUINodeField,
  EndgeUIPatch,
  EndgeUIPatchOperation,
} from '@/features/core/modules/ui/domain/types/endge-ui-json.types'
import { ENDGE_UI_JSON_FORMAT } from '@/features/core/modules/ui/domain/types/endge-ui-json.types'

const NODE_FIELDS: readonly EndgeUINodeField[] = [
  'props',
  'text',
  'events',
  'classes',
  'states',
  'parts',
  'style',
  'component',
  'editable',
  'table',
  'menu',
  'markers',
]

// Строит минимальный патч `endge-ui/v1` между двумя снимками одного mount.
export function diffEndgeUIJsonSnapshots(previous: EndgeUIJsonSnapshot, next: EndgeUIJsonSnapshot): EndgeUIPatch {
  const ops: EndgeUIPatchOperation[] = []
  if (!jsonEqual(previous.markers ?? [], next.markers ?? [])) {
    ops.push({ op: 'markers', markers: next.markers ?? [] })
  }
  diffChildren(null, previous.roots, next.roots, ops)
  return { format: ENDGE_UI_JSON_FORMAT, baseRevision: previous.revision, revision: next.revision, ops }
}

// Применяет патч к снимку и возвращает новый снимок; исходный снимок не изменяется.
export function applyEndgeUIPatch(snapshot: EndgeUIJsonSnapshot, patch: EndgeUIPatch): EndgeUIJsonSnapshot {
  if (patch.format !== ENDGE_UI_JSON_FORMAT) {
    throw new Error(`[EndgeUI] Unsupported patch format: ${String(patch.format)}`)
  }
  if (patch.baseRevision !== snapshot.revision) {
    throw new Error(`[EndgeUI] Patch base revision ${patch.baseRevision} does not match snapshot revision ${snapshot.revision}`)
  }
  const result: EndgeUIJsonSnapshot = structuredClone(snapshot)
  const index = new Map<string, EndgeUINode>()
  const visit = (nodes: EndgeUINode[]) => nodes.forEach((node) => {
    index.set(node.id, node)
    visit(node.children)
  })
  visit(result.roots)

  for (const op of patch.ops) {
    if (op.op === 'markers') {
      if (op.markers.length) {
        result.markers = structuredClone(op.markers)
      }
      else {
        delete result.markers
      }
      continue
    }
    if (op.op === 'children') {
      const children = op.children.map((entry) => {
        if (isRef(entry)) {
          const known = index.get(entry.ref)
          if (!known) {
            throw new Error(`[EndgeUI] Patch references unknown node: ${entry.ref}`)
          }
          return known
        }
        const node = structuredClone(entry)
        visit([node])
        return node
      })
      if (op.id === null) {
        result.roots = children
      }
      else {
        requireNode(index, op.id).children = children
      }
      continue
    }
    const target = requireNode(index, op.id)
    if (op.op === 'replace') {
      const node = structuredClone(op.node)
      replaceInPlace(target, node)
      visit([target])
      continue
    }
    for (const field of op.unset ?? []) {
      delete (target as Partial<EndgeUINode>)[field]
    }
    Object.assign(target, structuredClone(op.set ?? {}))
  }
  result.revision = patch.revision
  return result
}

function diffChildren(
  parentId: string | null,
  previous: EndgeUINode[],
  next: EndgeUINode[],
  ops: EndgeUIPatchOperation[],
): void {
  const previousById = new Map(previous.map(node => [node.id, node]))
  const sameOrder = previous.length === next.length && previous.every((node, index) => node.id === next[index]!.id)
  if (!sameOrder) {
    const children: EndgeUIChildEntry[] = next.map(node => previousById.has(node.id) ? { ref: node.id } : node)
    ops.push({ op: 'children', id: parentId, children })
  }
  for (const node of next) {
    const before = previousById.get(node.id)
    if (before) {
      diffNode(before, node, ops)
    }
  }
}

function diffNode(previous: EndgeUINode, next: EndgeUINode, ops: EndgeUIPatchOperation[]): void {
  if (previous.type !== next.type) {
    ops.push({ op: 'replace', id: next.id, node: next })
    return
  }
  const set: Partial<Record<EndgeUINodeField, unknown>> = {}
  const unset: EndgeUINodeField[] = []
  for (const field of NODE_FIELDS) {
    const before = previous[field]
    const after = next[field]
    if (after === undefined) {
      if (before !== undefined) {
        unset.push(field)
      }
      continue
    }
    if (!jsonEqual(before, after)) {
      set[field] = after
    }
  }
  if (Object.keys(set).length || unset.length) {
    ops.push({
      op: 'update',
      id: next.id,
      ...(Object.keys(set).length ? { set: set as Partial<Pick<EndgeUINode, EndgeUINodeField>> } : {}),
      ...(unset.length ? { unset } : {}),
    })
  }
  diffChildren(next.id, previous.children, next.children, ops)
}

function replaceInPlace(target: EndgeUINode, node: EndgeUINode): void {
  for (const key of Object.keys(target)) {
    delete (target as unknown as Record<string, unknown>)[key]
  }
  Object.assign(target, node)
}

function requireNode(index: Map<string, EndgeUINode>, id: string): EndgeUINode {
  const node = index.get(id)
  if (!node) {
    throw new Error(`[EndgeUI] Patch targets unknown node: ${id}`)
  }
  return node
}

function isRef(entry: EndgeUIChildEntry): entry is { ref: string } {
  return 'ref' in entry && !('type' in entry)
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false
  }
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]))
  }
  if (Array.isArray(right)) {
    return false
  }
  const leftKeys = Object.keys(left)
  const rightRecord = right as Record<string, unknown>
  return leftKeys.length === Object.keys(right).length
    && leftKeys.every(key => Object.hasOwn(rightRecord, key) && jsonEqual((left as Record<string, unknown>)[key], rightRecord[key]))
}
