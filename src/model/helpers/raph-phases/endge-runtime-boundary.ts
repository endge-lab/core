import type { DepGraph, PhaseEvent, PhaseExecutorContext, PhaseName, RaphPhase } from '@endge/raph'

import { RaphNode } from '@endge/raph'

/** Опции фабрики */
export interface BoundaryPhaseOptions {
  isBoundary: (n: RaphNode) => boolean
  toRoot?: (boundary: RaphNode, graph: DepGraph) => RaphNode | null
  emitToRoot: (root: RaphNode, children: PhaseExecutorContext[]) => void
  onBoundary?: (boundary: RaphNode) => void
  name?: PhaseName
  routes?: string[]
  nodes?: (n: RaphNode) => boolean
}

/* - - -  Кэш ближайшего boundary на ноде - - -  */
const SYM_BVER = Symbol('raph.boundary.ver')
const SYM_BNEAR = Symbol('raph.boundary.near')
let BOUNDARY_VERSION = 1

export function invalidateBoundaryCache(): void {
  BOUNDARY_VERSION++
}

function nearestBoundary(
  start: RaphNode,
  graph: DepGraph,
  isBoundary: (n: RaphNode) => boolean,
): RaphNode | null {
  const any = start as any
  if (any[SYM_BVER] === BOUNDARY_VERSION)
    return (any[SYM_BNEAR] ?? null) as RaphNode | null

  if (isBoundary(start)) {
    any[SYM_BNEAR] = start
    any[SYM_BVER] = BOUNDARY_VERSION
    return start
  }

  const seen = new Set<string>()
  const q: RaphNode[] = []
  let qi = 0
  q.push(start)
  seen.add(start.id)

  while (qi < q.length) {
    const node = q[qi++]
    const parents = graph.parentsOf(node)
    if (parents.size === 0)
      continue

    // пробуем найти boundary на текущем слое родителей
    for (const p of parents) {
      if (seen.has(p.id))
        continue
      if (isBoundary(p)) {
        any[SYM_BNEAR] = p
        any[SYM_BVER] = BOUNDARY_VERSION
        return p
      }
    }

    // иначе расширяем фронт
    for (const p of parents) {
      if (seen.has(p.id))
        continue
      seen.add(p.id)
      q.push(p)
    }
  }

  any[SYM_BNEAR] = null
  any[SYM_BVER] = BOUNDARY_VERSION
  return null
}

export function createBoundaryAggregationPhase(
  graph: DepGraph,
  opts: BoundaryPhaseOptions,
): RaphPhase {
  const {
    isBoundary,
    toRoot = (b, g) => {
      const seen = new Set<string>()
      const q: RaphNode[] = [b]
      let qi = 0
      seen.add(b.id)

      while (qi < q.length) {
        const n = q[qi++]
        if (n.meta?.kind === 'root')
          return n

        for (const p of g.parentsOf(n)) {
          if (seen.has(p.id))
            continue
          seen.add(p.id)
          q.push(p)
        }
      }
      return null
    },
    emitToRoot,
    onBoundary,
    name = 'tables' as PhaseName,
    routes = ['*'],
    nodes = (n: RaphNode) => n.meta?.type === 'table',
  } = opts

  return {
    name,
    routes,
    traversal: 'dirty-only',
    nodes,

    all: (ctxs) => {
      if (!ctxs.length)
        return

      // ---------------- DEBUG (всё, что нужно для поиска col/row) ----------------
      console.groupCollapsed(`[PHASE:${String(name)}] ctxs=${ctxs.length}`)
      try {
        console.log(
          '[ctxs meta]',
          ctxs.map(c => ({
            nodeId: c.node?.id,
            kind: c.node?.meta?.kind,
            type: c.node?.meta?.type,
            entityId: c.node?.meta?.entityId,
            basePath: c.node?.meta?.basePath,
            runtimeId: c.node?.meta?.runtimeId,
            columnIndex: c.node?.meta?.columnIndex,
            events: c.events?.length ?? 0,
            canonical: (c.events ?? []).map((e: any) => e?.canonical),
            resolvedLens: (c.events ?? []).map(
              (e: any) => e?.resolved?.length ?? 0,
            ),
          })),
        )
      }
      finally {
        console.groupEnd()
      }
      // -------------------------------------------------------------------------

      // nodeId -> PhaseEvent[]
      const eventsByNode = new Map<string, PhaseEvent[]>()
      for (const { node, events } of ctxs) {
        if (events?.length)
          eventsByNode.set(node.id, events)
      }

      // rootId -> Map<boundaryId, PhaseExecutorContext>
      const byRoot = new Map<string, Map<string, PhaseExecutorContext>>()
      const boundaryNotified = onBoundary ? new Set<string>() : null

      // rootId set (dirty пришёл прямо на root)
      const dirtyRoots = new Set<string>()

      for (const ctx of ctxs) {
        const dirtyNode = ctx.node
        const kind = dirtyNode.meta?.kind

        // 0) Если dirty пришёл на root -  запоминаем и НЕ пытаемся искать колонку/строку
        if (kind === 'root') {
          dirtyRoots.add(dirtyNode.id)

          // DEBUG
          console.log('[tables] dirty ROOT', {
            dirtyNodeId: dirtyNode.id,
            basePath: dirtyNode.meta?.basePath,
            runtimeId: dirtyNode.meta?.runtimeId,
            events: ctx.events ?? [],
          })

          continue
        }

        // 1) Найти ближайший boundary
        const b = nearestBoundary(dirtyNode, graph, isBoundary)
        if (!b) {
          // DEBUG
          console.warn('[tables] nearestBoundary NOT FOUND', {
            dirtyNodeId: dirtyNode.id,
            dirtyKind: kind,
            dirtyMeta: dirtyNode.meta,
            events: eventsByNode.get(dirtyNode.id),
          })
          continue
        }

        // DEBUG: boundary + колонка
        console.groupCollapsed('[tables] boundary found')
        try {
          console.log('dirtyNode', {
            id: dirtyNode.id,
            kind: dirtyNode.meta?.kind,
            meta: dirtyNode.meta,
          })
          console.log('boundaryNode', {
            id: b.id,
            kind: b.meta?.kind,
            columnIndex: b.meta?.columnIndex,
            meta: b.meta,
          })
          console.log(
            'dirty events',
            (eventsByNode.get(dirtyNode.id) ?? []).map((e: any) => ({
              original: e.original,
              canonical: e.canonical,
              resolved: e.resolved,
            })),
          )
        }
        finally {
          console.groupEnd()
        }

        // onBoundary -  один раз за тик
        if (boundaryNotified && !boundaryNotified.has(b.id)) {
          boundaryNotified.add(b.id)
          onBoundary!(b)
        }

        // 2) Найти root для boundary
        const r = toRoot(b, graph)
        if (!r) {
          // DEBUG
          console.warn('[tables] toRoot NOT FOUND', {
            boundaryId: b.id,
            boundaryMeta: b.meta,
          })
          continue
        }

        // DEBUG: root
        console.log('[tables] root resolved', {
          rootId: r.id,
          rootRuntimeId: r.meta?.runtimeId,
          rootBasePath: r.meta?.basePath,
          boundaryId: b.id,
          boundaryColumnIndex: b.meta?.columnIndex,
        })

        // 3) Агрегация boundary контекстов по root
        let map = byRoot.get(r.id)
        if (!map) {
          map = new Map<string, PhaseExecutorContext>()
          byRoot.set(r.id, map)
        }

        const existing = map.get(b.id)
        const ev = eventsByNode.get(dirtyNode.id)

        if (!existing) {
          map.set(b.id, {
            phase: name,
            node: b,
            events: ev?.slice(),
          })
        }
        else if (ev?.length) {
          if (!existing.events)
            existing.events = ev.slice()
          else existing.events.push(...ev)
        }
      }

      // 4) emit update:boundaries (один раз на root)
      for (const [rootId, childrenMap] of byRoot) {
        const root = graph.getNode(rootId)
        if (!root)
          continue

        const children = Array.from(childrenMap.values())

        // DEBUG summary
        console.groupCollapsed('[tables] emitToRoot update:boundaries')
        try {
          console.log('root', {
            id: root.id,
            runtimeId: root.meta?.runtimeId,
            basePath: root.meta?.basePath,
          })
          console.log(
            'children',
            children.map(c => ({
              boundaryId: c.node.id,
              columnIndex: c.node.meta?.columnIndex,
              events: c.events?.length ?? 0,
              resolvedLens: (c.events ?? []).map(
                (e: any) => e?.resolved?.length ?? 0,
              ),
              canonicals: (c.events ?? []).map((e: any) => e?.canonical),
            })),
          )
        }
        finally {
          console.groupEnd()
        }

        emitToRoot(root, children)
      }

      // 5) emit update:root для root-нод, которые стали dirty напрямую
      //    (и при этом по ним не было update:boundaries в этом тике)
      for (const rootId of dirtyRoots) {
        if (byRoot.has(rootId))
          continue

        const root = graph.getNode(rootId)
        if (!root)
          continue

        // DEBUG
        console.log('[tables] emitToRoot update:root', {
          rootId: root.id,
          runtimeId: root.meta?.runtimeId,
          basePath: root.meta?.basePath,
        })

        emitToRoot(root, [])
      }
    },
  }
}


// ---------- TABLES phase (dirty -> nearest boundary -> root aggregation) ----------
// Raph.addPhase(
//   createBoundaryAggregationPhase(Raph.app.graph, {
//     name: 'tables' as PhaseName,
//     routes: ['*'],
//     nodes: (node: RaphNode) => node.meta?.type === 'table',
//
//     // boundary -  только колонка
//     isBoundary: (n) => n.meta?.kind === 'boundary',
//
//     // root ищем отдельно
//     toRoot: (b, g) => {
//       const seen = new Set<string>()
//       const q: RaphNode[] = [b]
//       let qi = 0
//       seen.add(b.id)
//       while (qi < q.length) {
//         const n = q[qi++]
//         if (n.meta?.kind === 'root') return n
//         for (const p of g.parentsOf(n)) {
//           if (seen.has(p.id)) continue
//           seen.add(p.id)
//           q.push(p)
//         }
//       }
//       return null
//     },
//
//     emitToRoot: (root, children) => {
//       const runtimeId = root.meta?.runtimeId
//       if (!runtimeId) return
//       const rt = this._runtimes.get(String(runtimeId))
//       if (!rt) return
//
//       //  если children пуст -  это root update
//       if (!children?.length) rt.emit('update:root', {})
//       else rt.emit('update:boundaries', { children })
//     },
//   }),
// )
