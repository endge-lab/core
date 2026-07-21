import { describe, expect, it, vi } from 'vitest'

import { SFCRenderInspectionSession } from '@/model/services/runtime/SFCRenderInspectionSession'

describe('SFCRenderInspectionSession', () => {
  it('keeps stable instance ids and builds a live hierarchy', async () => {
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

  it('isolates repeated node definitions by renderer scope', () => {
    const session = new SFCRenderInspectionSession()
    const first = session.registerNode(createNode({ scope: 'root/row:flight-1', nodeId: 'root-0' }))
    const second = session.registerNode(createNode({ scope: 'root/row:flight-2', nodeId: 'root-0' }))

    expect(first).not.toBe(second)
    expect(session.getTree()).toHaveLength(2)

    session.clearRuntime('runtime-1')
    expect(session.getTree()).toEqual([])
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
