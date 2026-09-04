import { describe, expect, it } from 'vitest'

import {
  inspectComponentSFCProps,
  patchComponentSFCPropsSource,
} from '@/features/core/modules/source/services/component-sfc/component-sfc-props-source-patch'

const TABLE_SOURCE = `<script setup lang="ts">
defineProps<{
  rows: Flight[]
}>()
</script>

<template>
  <Table :rows="rows" />
</template>
`

describe('изменение props в Source компонента SFC', () => {
  it('заменяет inline-контракт defineProps без перезаписи шаблона', () => {
    const result = patchComponentSFCPropsSource(TABLE_SOURCE, [
      { name: 'items', type: 'Flight', isArray: true },
      { name: 'selectedId', type: 'string', optional: true },
    ])

    expect(result.ok).toBe(true)
    expect(result.source).toContain('items: Flight[]')
    expect(result.source).toContain('selectedId?: string')
    expect(result.source).toContain('<Table :rows="rows" />')
  })

  it('вставляет defineProps в существующий script setup', () => {
    const result = patchComponentSFCPropsSource(`<script setup lang="ts">\nconst ready = true\n</script>\n<template><Table /></template>`, [
      { name: 'rows', type: 'unknown', isArray: true },
    ])

    expect(result.ok).toBe(true)
    expect(result.source).toContain('defineProps<{\n  rows: unknown[]\n}>()')
    expect(result.source).toContain('const ready = true')
  })

  it('оставляет именованные контракты во владении Source', () => {
    const source = `<script setup lang="ts">\ninterface Props { rows: string[] }\ndefineProps<Props>()\n</script>\n<template><Table /></template>`
    const projection = inspectComponentSFCProps(source)
    const result = patchComponentSFCPropsSource(source, [])

    expect(projection.mode).toBe('named-type')
    expect(projection.editable).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
  })
})
