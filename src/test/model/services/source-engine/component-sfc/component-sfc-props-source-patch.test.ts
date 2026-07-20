import { describe, expect, it } from 'vitest'

import {
  inspectComponentSFCProps,
  patchComponentSFCPropsSource,
} from '@/model/services/source-engine/component-sfc/component-sfc-props-source-patch'

const TABLE_SOURCE = `<script setup lang="ts">
defineProps<{
  rows: Flight[]
}>()
</script>

<template>
  <Table :rows="rows" />
</template>
`

describe('component SFC props source patch', () => {
  it('replaces an inline defineProps contract without rewriting the template', () => {
    const result = patchComponentSFCPropsSource(TABLE_SOURCE, [
      { name: 'items', type: 'Flight', isArray: true },
      { name: 'selectedId', type: 'string', optional: true },
    ])

    expect(result.ok).toBe(true)
    expect(result.source).toContain('items: Flight[]')
    expect(result.source).toContain('selectedId?: string')
    expect(result.source).toContain('<Table :rows="rows" />')
  })

  it('inserts defineProps into an existing script setup', () => {
    const result = patchComponentSFCPropsSource(`<script setup lang="ts">\nconst ready = true\n</script>\n<template><Table /></template>`, [
      { name: 'rows', type: 'unknown', isArray: true },
    ])

    expect(result.ok).toBe(true)
    expect(result.source).toContain('defineProps<{\n  rows: unknown[]\n}>()')
    expect(result.source).toContain('const ready = true')
  })

  it('keeps named contracts Source-owned', () => {
    const source = `<script setup lang="ts">\ninterface Props { rows: string[] }\ndefineProps<Props>()\n</script>\n<template><Table /></template>`
    const projection = inspectComponentSFCProps(source)
    const result = patchComponentSFCPropsSource(source, [])

    expect(projection.mode).toBe('named-type')
    expect(projection.editable).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
  })
})
