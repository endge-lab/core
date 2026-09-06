import type { EndgeModuleDescriptor } from '@/features/federation/types/endge-modules.types'

interface EndgeOrderedDescriptor {
  readonly key: string
  readonly before?: string | readonly string[]
  readonly after?: string | readonly string[]
}

function toArray(value: string | readonly string[] | undefined): string[] {
  if (!value) {
    return []
  }
  return typeof value === 'string' ? [value] : [...value]
}

export function sortEndgeOrderedDescriptors<TDescriptor extends EndgeOrderedDescriptor>(
  descriptors: readonly TDescriptor[],
): TDescriptor[] {
  const byKey = new Map<string, TDescriptor>()
  const declarationIndex = new Map<string, number>()

  descriptors.forEach((descriptor, index) => {
    const key = String(descriptor.key ?? '').trim()

    if (!key) {
      throw new Error('[EndgeFederation] lifecycle node key is required')
    }
    if (byKey.has(key)) {
      throw new Error(`[EndgeFederation] lifecycle node "${key}" is already defined`)
    }

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
    if (!byKey.has(from)) {
      throw new Error(`[EndgeFederation] lifecycle node "${owner}" references unknown node "${from}"`)
    }
    if (!byKey.has(to)) {
      throw new Error(`[EndgeFederation] lifecycle node "${owner}" references unknown node "${to}"`)
    }
    if (from === to) {
      throw new Error(`[EndgeFederation] lifecycle node "${owner}" cannot reference itself`)
    }

    const targets = edges.get(from)!
    if (targets.has(to)) {
      return
    }

    targets.add(to)
    indegree.set(to, indegree.get(to)! + 1)
  }

  for (const descriptor of byKey.values()) {
    for (const target of toArray(descriptor.before)) {
      addEdge(descriptor.key, target, descriptor.key)
    }

    for (const source of toArray(descriptor.after)) {
      addEdge(source, descriptor.key, descriptor.key)
    }
  }

  const compare = (a: TDescriptor, b: TDescriptor): number =>
    declarationIndex.get(a.key)! - declarationIndex.get(b.key)!

  const ready = Array.from(byKey.values())
    .filter(item => indegree.get(item.key) === 0)
    .sort(compare)

  const result: TDescriptor[] = []

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

    throw new Error(`[EndgeFederation] circular lifecycle order dependency: ${unresolved.join(', ')}`)
  }

  return result
}

export function sortEndgeModuleDescriptors(
  descriptors: EndgeModuleDescriptor[],
): EndgeModuleDescriptor[] {
  for (const descriptor of descriptors) {
    if (!descriptor.module) {
      throw new Error(`[EndgeFederation] module "${descriptor.key}" is required`)
    }
  }
  return sortEndgeOrderedDescriptors(descriptors)
}
