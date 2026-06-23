import type {
  EventRecord,
  LogRecord,
  SpanEnd,
  SpanStart,
} from '@/domain/types/debug/base.types'
import type {
  EventNode,
  LogNode,
  SpanNode,
} from '@/domain/types/debug/tree.types'

/**
 * Строит дерево:
 *  - span_start - создаём SpanNode; если есть parentSpanId - вставляем как ребёнка, иначе в корень
 *  - span_end   - дополняем соответствующий SpanNode (endTs/durMs)
 *  - event      - кладём внутрь спана по corr.spanId; если не нашли - в корень (fallback)
 *
 * Никаких Trace-узлов здесь нет - корневыми узлами считаются «root spans»
 * (те, у которых нет corr.parentSpanId).
 */
export function buildLogTree(records: LogRecord[]): LogNode[] {
  const items = [...records].sort((a, b) => a.ts - b.ts)

  const spanById = new Map<string, SpanNode>()
  const root: LogNode[] = []

  /** Вставка узла в parent span либо в корень, если родителя ещё нет. */
  const attachToParent = (
    node: LogNode,
    parentSpanId?: string | null | undefined,
  ) => {
    if (parentSpanId) {
      const p = spanById.get(parentSpanId)
      if (p) {
        p.children.push(node)
        return
      }
      // родитель пока не встречен - не теряем, кладём во временный корень
      root.push(node)
      return
    }
    // это корневой спан
    root.push(node)
  }

  for (const r of items) {
    if (r.kind === 'span_start') {
      const s = r as SpanStart
      const node: SpanNode = {
        kind: 'span',
        ts: s.ts,
        endTs: undefined,
        durMs: null,
        level: s.level,
        lane: s.lane,
        name: s.name,
        corr: s.corr,
        attrs: s.attrs,
        entities: s.entities,
        children: [],
      }
      const id = s.corr?.spanId ?? `span@${s.ts}:${s.name}`
      spanById.set(id, node)
      attachToParent(node, s.corr?.parentSpanId)
      continue
    }

    if (r.kind === 'span_end') {
      const e = r as SpanEnd
      const id = e.corr?.spanId ?? `span@${e.ts}:${e.name}`
      const node = spanById.get(id)
      if (node) {
        node.endTs = e.ts
        node.durMs =
          typeof e.durMs === 'number' ? e.durMs : Math.max(0, e.ts - node.ts)
      } else {
        // конец без старта - создаём деградирующий узел (чтобы ничего не потерять)
        const degraded: SpanNode = {
          kind: 'span',
          ts: e.ts,
          endTs: e.ts,
          durMs: 0,
          level: e.level,
          lane: e.lane,
          name: e.name,
          corr: e.corr,
          attrs: e.attrs,
          entities: e.entities,
          children: [],
        }
        root.push(degraded)
      }
      continue
    }

    if (r.kind === 'event') {
      const ev = r as EventRecord
      const node: EventNode = {
        kind: 'event',
        ts: ev.ts,
        level: ev.level,
        lane: ev.lane,
        name: ev.name,
        corr: ev.corr,
        attrs: ev.attrs,
        entities: ev.entities,
        msg: ev.msg,
        data: ev.data,
        err: ev.err,
      }
      const parent = ev.corr?.spanId ? spanById.get(ev.corr.spanId) : null
      parent ? parent.children.push(node) : root.push(node)
      continue
    }
  }

  return root
}
