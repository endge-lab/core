import type {
  RComponentSFC_IR,
  RComponentSFC_IR_Directives,
  RComponentSFC_IR_Node,
  RComponentSFC_IR_Read,
  RComponentSFC_IR_Value,
  RComponentSFC_RuntimeDependencies,
  RComponentSFC_RuntimeDependency,
} from '@/domain/types/component-sfc.types'
import { createEmptyComponentSFCRuntimeDependencies } from '@/domain/types/component-sfc.types'

/** Анализирует SFC IR и собирает runtime-зависимости от входных props. */
export function analyzeComponentSFCRuntimeDependencies(
  ir: RComponentSFC_IR | null,
): RComponentSFC_RuntimeDependencies {
  const result = createEmptyComponentSFCRuntimeDependencies()
  if (!ir)
    return result

  const props = new Set(ir.script.props.map(prop => prop.name))
  const seen = new Set<string>()

  for (const node of ir.template.roots)
    collectNodeDependencies(node, props, result, seen)

  result.props = prunePrefixDependencies(result.props)

  return result
}

function collectNodeDependencies(
  node: RComponentSFC_IR_Node,
  props: Set<string>,
  result: RComponentSFC_RuntimeDependencies,
  seen: Set<string>,
): void {
  if (node.kind === 'expression') {
    collectValueDependencies(node.value, props, result, seen)
    return
  }

  if (node.kind !== 'element')
    return

  for (const value of Object.values(node.props))
    collectValueDependencies(value, props, result, seen)

  collectDirectiveDependencies(node.directives, props, result, seen)

  for (const child of node.children)
    collectNodeDependencies(child, props, result, seen)
}

function collectDirectiveDependencies(
  directives: RComponentSFC_IR_Directives,
  props: Set<string>,
  result: RComponentSFC_RuntimeDependencies,
  seen: Set<string>,
): void {
  collectValueDependencies(directives.if, props, result, seen)
  collectValueDependencies(directives.elseIf, props, result, seen)
  collectValueDependencies(directives.key, props, result, seen)
  collectValueDependencies(directives.for?.source, props, result, seen)
}

function collectValueDependencies(
  value: RComponentSFC_IR_Value | undefined,
  props: Set<string>,
  result: RComponentSFC_RuntimeDependencies,
  seen: Set<string>,
): void {
  if (!value || value.kind !== 'expression')
    return

  for (const read of value.reads) {
    const dependency = normalizePropDependency(read, props)
    if (!dependency)
      continue

    const key = `${dependency.prop}.${dependency.path.join('.')}`
    if (seen.has(key))
      continue

    seen.add(key)
    result.props.push(dependency)
  }
}

function normalizePropDependency(
  read: RComponentSFC_IR_Read,
  props: Set<string>,
): RComponentSFC_RuntimeDependency | null {
  if (read.source !== 'props')
    return null

  const path = [...read.path]
  if (path[0] === 'props')
    path.shift()

  const prop = path.shift()
  if (!prop || !props.has(prop))
    return null

  return {
    source: 'props',
    prop,
    path,
    raw: read.raw,
    read,
  }
}

function prunePrefixDependencies(
  dependencies: RComponentSFC_RuntimeDependency[],
): RComponentSFC_RuntimeDependency[] {
  return dependencies.filter((candidate) => {
    return !dependencies.some(other => {
      if (candidate === other || candidate.prop !== other.prop)
        return false

      return candidate.path.length < other.path.length
        && candidate.path.every((part, index) => part === other.path[index])
    })
  })
}
