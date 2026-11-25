import type { RuntimeHostUpdateContext, RuntimeTimelineCollection, RuntimeTimelineDataPatch, RuntimeTimelineEntityUpdate } from '../domain/runtime-host.types'
import { DataPath, Raph } from '@raphy-js/raph'

const collections = new Set<string>(['groups', 'tasks', 'backgrounds', 'points', 'links'])

export function createRuntimeTimelineDataPatch(
  ctx: RuntimeHostUpdateContext,
  boundaryId: string,
  sourcePath: string,
): RuntimeTimelineDataPatch {
  const source = DataPath.from(sourcePath)
  const dataSnapshot = Raph.get(source)
  return {
    kind: 'timeline-data-update',
    boundaryType: 'timeline',
    boundaryId,
    sourcePath: source.toString(),
    dataSnapshot,
    updates: ctx.events.length && isRecord(dataSnapshot) ? collectUpdates(source, dataSnapshot, ctx.events) : null,
    events: ctx.events,
    node: ctx.node,
  }
}

function collectUpdates(
  source: DataPath,
  data: Record<string, unknown>,
  events: RuntimeHostUpdateContext['events'],
): RuntimeTimelineEntityUpdate[] | null {
  const sourcePath = source.toString()
  const offset = source.segments().length
  const prefix = `${sourcePath}.`
  const updates = new Map<string, RuntimeTimelineEntityUpdate>()

  for (const event of events) {
    if (!event.path.startsWith(prefix)) {
      return null
    }
    const segments = DataPath.from(event.path).segments()
    const collection = segments[offset]
    const selector = segments[offset + 1]
    const field = segments[offset + 2]
    if (collection?.kind !== 'key' || !collections.has(collection.key) || !selector) {
      return null
    }

    const rows = data[collection.key]
    if (!Array.isArray(rows)) {
      return null
    }
    const row: unknown = selector.kind === 'index'
      ? rows[selector.index]
      : selector.kind === 'selector' && selector.key === 'id' && typeof selector.value === 'string'
        ? Raph.get(`${sourcePath}.${collection.key}[id=$timelineId]`, { vars: { timelineId: selector.value } })
        : undefined
    if (!isRecord(row) || typeof row.id !== 'string' || !row.id
      || (selector.kind === 'selector' && selector.value !== row.id)) {
      return null
    }

    let fields: string[]
    if (!field) {
      if (event.kind === 'delete' || !isRecord(event.previous) || event.previous.id !== row.id) {
        return null
      }
      const previous = event.previous
      fields = [...new Set([...Object.keys(previous), ...Object.keys(row)])]
        .filter(key => key !== 'id' && !Object.is(previous[key], row[key]))
    }
    else {
      if (field.kind !== 'key' || field.key === 'id') {
        return null
      }
      fields = [field.key]
    }
    const key = `${collection.key}:${row.id}`
    const update = updates.get(key) ?? {
      collection: collection.key as RuntimeTimelineCollection,
      id: row.id,
      fields: Object.create(null) as Record<string, unknown>,
    }
    for (const field of fields) {
      if (!Object.hasOwn(row, field) || row[field] === undefined) {
        return null
      }
      update.fields[field] = row[field]
    }
    if (fields.length) {
      updates.set(key, update)
    }
  }

  return [...updates.values()]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
