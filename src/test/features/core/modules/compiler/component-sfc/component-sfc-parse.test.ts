import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'
import { parseComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-parse'
import { inspectComponentSFCVisual } from '@/features/core/modules/source/services/component-sfc/component-sfc-visual-projection'

describe('разбор Component SFC', () => {
  it('возвращает диагностику вместо исключения для незавершённого тега template', () => {
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

  it('оставляет компиляцию и визуальную инспекцию нефатальными для незавершённого черновика', () => {
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
