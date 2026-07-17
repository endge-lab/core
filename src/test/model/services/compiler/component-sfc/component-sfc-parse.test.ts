import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { parseComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-parse'
import { inspectComponentSFCVisual } from '@/model/services/source-engine/component-sfc/component-sfc-visual-projection'

describe('parseComponentSFC', () => {
  it('returns diagnostics instead of throwing for an unfinished template tag', () => {
    const source = `<template>
  <Table>
</template>`

    expect(() => parseComponentSFC(source)).not.toThrow()

    const parsed = parseComponentSFC(source)
    expect(parsed.ast).toBeNull()
    expect(parsed.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: 'error',
        code: 'sfc-parse-error',
        message: 'Element is missing end tag.',
      }),
    ]))
  })

  it('keeps compile and visual inspection non-fatal for an unfinished draft', () => {
    const source = `<template>
  <Table><Column>
</template>`

    const compiled = compileComponentSFC(source)
    const inspection = inspectComponentSFCVisual(source)

    expect(compiled.ast).toBeNull()
    expect(compiled.ir).toBeNull()
    expect(compiled.diagnostics.some(diagnostic => diagnostic.severity === 'error')).toBe(true)
    expect(inspection.support).toEqual({ kind: 'none', reason: 'template-missing' })
    expect(inspection.projection).toBeNull()
  })
})
