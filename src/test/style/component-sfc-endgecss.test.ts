import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { compileEndgeCSS } from '@/model/services/style/endgecss-compile'

describe('SFC EndgeCSS compilation', () => {
  it('uses the shared artifact and derives a stable identity scope', () => {
    const source = `<template><Text id="status">Ready</Text></template>
<style scoped lang="endgecss">#status { color: green; }</style>`
    const first = compileComponentSFC(source, { identity: 'flight-board' })
    const second = compileComponentSFC(source, { identity: 'flight-board' })
    const global = compileEndgeCSS('#status { color: green; }', { identity: 'global' }).artifact!

    expect(first.ir?.style?.language).toBe('endgecss')
    expect(first.ir?.style?.scope).toBe('component')
    expect(first.ir?.style?.scopeId).toBe(second.ir?.style?.scopeId)
    expect(first.ir?.style?.rules.map(rule => rule.declarations)).toEqual(global.rules.map(rule => rule.declarations))
  })

  it('keeps a component renderable when only its style is invalid', () => {
    const result = compileComponentSFC(`<template><Text>Ready</Text></template>
<style lang="css">Text { color: red; }</style>`, { identity: 'flight-board' })
    expect(result.ir?.template.roots).toHaveLength(1)
    expect(result.ir?.style).toBeNull()
    expect(result.sections.style).toBe('error')
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'sfc-style-lang-unsupported', severity: 'error' }))
  })
})
