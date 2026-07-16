import { describe, expect, it } from 'vitest'

import { compileEndgeCSS } from '@/model/services/style/endgecss-compile'
import { matchEndgeStyleSelector, resolveEndgeStyleDeclarations } from '@/model/services/style/endgecss-match'
import type { EndgeStyleMatchNode } from '@/domain/types/style'

function node(input: Partial<EndgeStyleMatchNode> & Pick<EndgeStyleMatchNode, 'tag'>): EndgeStyleMatchNode {
  return {
    classes: new Set(),
    attributes: {},
    states: new Set(),
    parts: new Set(),
    index: 1,
    siblingCount: 1,
    ...input,
  }
}

describe('compileEndgeCSS', () => {
  it('compiles nesting, themes, scopes, supports and semantic selectors', () => {
    const result = compileEndgeCSS(`
      // SCSS-like line comments are accepted
      @theme dark {
        --surface: #111;
        .board { color: var(--text); }
      }

      @scope (:component(FlightBoard)) to (.nested-board) {
        .flight-card {
          color: black;
          &:state(delayed) > Text:nth-child(odd)::part(status) {
            color: red !important;
          }
        }
      }

      @supports renderer(dom) and not capability(print) {
        #status[data-tone="danger"] { opacity: .8; }
      }
    `, { identity: 'flight-style' })

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.themes.map(theme => theme.id)).toEqual(['dark'])
    expect(result.artifact?.rules).toHaveLength(4)
    const delayedRule = result.artifact?.rules.find(rule => rule.selectors[0].source.includes(':state(delayed)'))
    expect(delayedRule?.selectors[0].source).toContain('.flight-card:state(delayed) > Text:nth-child(odd)::part(status)')
    expect(delayedRule?.declarations[0].important).toBe(true)
    expect(result.artifact?.indexes.states.delayed).toHaveLength(1)
    expect(result.artifact?.indexes.parts.status).toHaveLength(1)
  })

  it('rejects @layer and reserves ::slot with explicit diagnostics', () => {
    const result = compileEndgeCSS('@layer base { Text { color: red; } }\nFlex::slot(actions) { gap: 1rem; }')
    expect(result.artifact).toBeNull()
    expect(result.diagnostics.map(item => item.code)).toEqual(expect.arrayContaining([
      'ENDGECSS_LAYER_FORBIDDEN',
      'ENDGECSS_SLOT_RESERVED',
    ]))
  })

  it('matches logical combinators and nth-child without a DOM tree', () => {
    const artifact = compileEndgeCSS('.list > Text:nth-child(even):state(selected) { color: red; }').artifact!
    const parent = node({ tag: 'Flex', classes: new Set(['list']) })
    const first = node({ tag: 'Text', parent, index: 1, siblingCount: 2 })
    const second = node({ tag: 'Text', parent, index: 2, siblingCount: 2, previousSiblings: [first], states: new Set(['selected']) })
    expect(matchEndgeStyleSelector(artifact.rules[0].selectors[0], second)).toBe(true)
  })

  it('resolves important, specificity and stable source order', () => {
    const artifact = compileEndgeCSS(`
      Text { color: gray; }
      .status { color: blue; }
      #critical { color: orange; }
      Text { color: red !important; }
    `).artifact!
    const target = node({ tag: 'Text', id: 'critical', classes: new Set(['status']) })
    const resolved = resolveEndgeStyleDeclarations([artifact], target, { renderer: 'dom' })
    expect(resolved.color.value).toBe('red')
    expect(resolved.color.important).toBe(true)
  })
})
