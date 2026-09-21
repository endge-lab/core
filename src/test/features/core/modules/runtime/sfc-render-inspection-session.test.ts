import { describe, expect, it, vi } from 'vitest'

import { SFCRenderInspectionSession } from '@/features/core/modules/runtime/services/SFCRenderInspectionSession'

describe('сессия инспекции render SFC', () => {
  it('сохраняет стабильные ID экземпляров и строит живую иерархию', async () => {
    const session = new SFCRenderInspectionSession()
    const listener = vi.fn()
    session.subscribe(listener)

    const rootId = session.registerNode(createNode({
      nodeId: '$component',
      kind: 'component',
      tag: 'departures-table',
    }))
    const childId = session.registerNode(createNode({
      parentId: rootId,
      nodeId: 'root-0',
      tag: 'Table',
      props: { rows: [{ id: 1 }] },
    }))
    const updatedChildId = session.registerNode(createNode({
      parentId: rootId,
      nodeId: 'root-0',
      tag: 'Table',
      props: { rows: [{ id: 2 }] },
    }))

    expect(updatedChildId).toBe(childId)
    expect(session.getTree()).toEqual([
      expect.objectContaining({
        id: rootId,
        children: [expect.objectContaining({ id: childId, props: { rows: [{ id: 2 }] } })],
      }),
    ])

    await Promise.resolve()
    expect(listener).toHaveBeenCalledOnce()
  })

  it('изолирует повторяющиеся определения узлов по scope renderer', () => {
    const session = new SFCRenderInspectionSession()
    const first = session.registerNode(createNode({ scope: 'root/row:flight-1', nodeId: 'root-0' }))
    const second = session.registerNode(createNode({ scope: 'root/row:flight-2', nodeId: 'root-0' }))

    expect(first).not.toBe(second)
    expect(session.getTree()).toHaveLength(2)

    session.clearRuntime('runtime-1')
    expect(session.getTree()).toEqual([])
  })

  it('хранит только ограниченные JSON-безопасные проекции и освобождает исходные значения', () => {
    const session = new SFCRenderInspectionSession()
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const raw = {
      long: 'x'.repeat(3_000),
      rows: Array.from({ length: 30 }, (_, index) => ({ index })),
      fields: Object.fromEntries(Array.from({ length: 60 }, (_, index) => [`field${index}`, index])),
      deep: { one: { two: { three: { four: { retained: false } } } } },
      circular,
      callable: () => 'raw',
    }
    const id = session.registerNode(createNode({
      props: raw,
      locals: { raw },
      bindings: { value: { kind: 'expression', reads: [], value: raw } },
    }))
    raw.rows.length = 0
    raw.long = 'mutated'

    const node = session.getNode(id)!
    expect((node.props.long as string)).toMatch(/\[truncated\]$/)
    expect(node.props.rows).toHaveLength(21)
    expect((node.props.fields as Record<string, unknown>).$truncated).toEqual({ omitted: 10 })
    expect(JSON.stringify(node)).toContain('"$truncated"')
    expect(JSON.stringify(node)).not.toContain('mutated')
    expect(() => JSON.stringify(node)).not.toThrow()

    session.unregisterNode(id)
    expect(session.getNode(id)).toBeNull()
  })
})

function createNode(overrides: Record<string, unknown> = {}) {
  return {
    runtimeId: 'runtime-1',
    componentIdentity: 'departures-table',
    componentStack: ['departures-table'],
    scope: 'root',
    parentId: null,
    nodeId: 'root-0',
    kind: 'element' as const,
    tag: 'Text',
    props: {},
    componentProps: {},
    locals: {},
    bindings: {},
    ...overrides,
  }
}
