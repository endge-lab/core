import type { EndgeModuleDescriptor } from '@/domain/types/endge-modules.types'

function toArray(value: string | string[] | undefined): string[] {
  if (!value)
    return []
  return Array.isArray(value) ? value : [value]
}

export function sortEndgeModuleDescriptors(
  descriptors: EndgeModuleDescriptor[],
): EndgeModuleDescriptor[] {
  const byKey = new Map<string, EndgeModuleDescriptor>()
  const declarationIndex = new Map<string, number>()

  descriptors.forEach((descriptor, index) => {
    const key = String(descriptor.key ?? '').trim()

    if (!key)
      throw new Error('[EndgeFederation] module key is required')
    if (!descriptor.module)
      throw new Error(`[EndgeFederation] module "${key}" is required`)
    if (byKey.has(key))
      throw new Error(`[EndgeFederation] module "${key}" is already defined`)

    byKey.set(key, { ...descriptor, key })
    declarationIndex.set(key, index)
  })

  const edges = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()

  for (const key of byKey.keys()) {
    edges.set(key, new Set())
    indegree.set(key, 0)
  }

  const addEdge = (from: string, to: string, owner: string): void => {
    if (!byKey.has(from))
      throw new Error(`[EndgeFederation] module "${owner}" references unknown module "${from}"`)
    if (!byKey.has(to))
      throw new Error(`[EndgeFederation] module "${owner}" references unknown module "${to}"`)
    if (from === to)
      throw new Error(`[EndgeFederation] module "${owner}" cannot reference itself`)

    const targets = edges.get(from)!
    if (targets.has(to))
      return

    targets.add(to)
    indegree.set(to, indegree.get(to)! + 1)
  }

  for (const descriptor of byKey.values()) {
    for (const target of toArray(descriptor.before))
      addEdge(descriptor.key, target, descriptor.key)

    for (const source of toArray(descriptor.after))
      addEdge(source, descriptor.key, descriptor.key)
  }

  const compare = (a: EndgeModuleDescriptor, b: EndgeModuleDescriptor): number =>
    declarationIndex.get(a.key)! - declarationIndex.get(b.key)!

  const ready = Array.from(byKey.values())
    .filter(item => indegree.get(item.key) === 0)
    .sort(compare)

  const result: EndgeModuleDescriptor[] = []

  while (ready.length) {
    const current = ready.shift()!
    result.push(current)

    for (const nextKey of edges.get(current.key)!) {
      indegree.set(nextKey, indegree.get(nextKey)! - 1)

      if (indegree.get(nextKey) === 0) {
        ready.push(byKey.get(nextKey)!)
        ready.sort(compare)
      }
    }
  }

  if (result.length !== byKey.size) {
    const resolved = new Set(result.map(item => item.key))
    const unresolved = Array.from(byKey.keys()).filter(key => !resolved.has(key))

    throw new Error(`[EndgeFederation] circular module order dependency: ${unresolved.join(', ')}`)
  }

  return result
}
