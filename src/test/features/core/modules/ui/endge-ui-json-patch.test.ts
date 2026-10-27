import type { EndgeUIJsonSnapshot } from '@/features/core/modules/ui/domain/types/endge-ui-json.types'

import { describe, expect, it } from 'vitest'
import { applyEndgeUIPatch, diffEndgeUIJsonSnapshots } from '@/features/core/modules/ui/adapters/json/endge-ui-json-patch'
import { ENDGE_UI_JSON_SCHEMA, validateEndgeUIJson } from '@/features/core/modules/ui/adapters/json/endge-ui-json.schema'

function snapshot(revision: number, roots: EndgeUIJsonSnapshot['roots']): EndgeUIJsonSnapshot {
  return { format: 'endge-ui/v1', revision, component: 'demo', roots }
}

describe('патчи и схема endge-ui/v1', () => {
  it('заменяет узел при смене типа, снимает поля и вставляет новые узлы', () => {
    const before = snapshot(1, [
      { id: 'a', type: 'Text', props: {}, children: [], text: 'A', events: ['click'] },
      { id: 'b', type: 'Text', props: {}, children: [] },
    ])
    const after = snapshot(2, [
      { id: 'c', type: 'Badge', props: { tone: 'info' }, children: [] },
      { id: 'a', type: 'Text', props: {}, children: [], text: 'A' },
      { id: 'b', type: 'Badge', props: {}, children: [] },
    ])
    const patch = diffEndgeUIJsonSnapshots(before, after)
    expect(patch.ops).toEqual([
      { op: 'children', id: null, children: [after.roots[0], { ref: 'a' }, { ref: 'b' }] },
      { op: 'update', id: 'a', unset: ['events'] },
      { op: 'replace', id: 'b', node: after.roots[2] },
    ])
    expect(validateEndgeUIJson(patch)).toEqual([])
    expect(applyEndgeUIPatch(before, patch)).toEqual(after)
    expect(before.roots).toHaveLength(2)
    expect(() => applyEndgeUIPatch(after, patch)).toThrow('does not match snapshot revision')
  })

  it('отклоняет документы вне схемы', () => {
    expect(ENDGE_UI_JSON_SCHEMA.$defs.snapshot.properties.format.const).toBe('endge-ui/v1')
    expect(validateEndgeUIJson({ format: 'endge-ui/v1', revision: 0, component: null, roots: [{ id: '', type: 'Span', props: {}, children: [], extra: 1 }] }, 'snapshot'))
      .toEqual([
        { path: '$.revision', message: 'must be >= 1' },
        { path: '$.roots[0].id', message: 'must have length >= 1' },
        { path: '$.roots[0].type', message: 'must be one of the allowed values' },
        { path: '$.roots[0]', message: 'must not have additional property "extra"' },
      ])
    expect(validateEndgeUIJson({ format: 'endge-ui/v1' })).toEqual([{ path: '$', message: 'must match exactly one schema in oneOf (matched 0)' }])
  })
})
