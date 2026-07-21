import { describe, expect, it } from 'vitest'

import {
  inspectComponentSFCMetadata,
  patchComponentSFCMetadataSource,
} from '@/model/services/source-engine/component-sfc/component-sfc-metadata-source-patch'

const TABLE_SOURCE = `<script setup lang="ts">
defineMetadata({
  "hub.table": {
    "attributes": ["STA", "ETA"]
  }
})

const rows = []
</script>

<template>
  <Table :rows="rows" />
</template>
`

describe('component SFC metadata source patch', () => {
  it('reads and replaces component-level defineMetadata without rewriting template source', () => {
    const projection = inspectComponentSFCMetadata(TABLE_SOURCE)
    const result = patchComponentSFCMetadataSource(TABLE_SOURCE, {
      'hub.table': { attributes: ['STA', 'ETA', 'ATA'] },
    })

    expect(projection.mode).toBe('static')
    expect(projection.metadata).toEqual({ 'hub.table': { attributes: ['STA', 'ETA'] } })
    expect(result.ok).toBe(true)
    expect(result.source).toContain('"ATA"')
    expect(result.source).toContain('const rows = []')
    expect(result.source).toContain('<Table :rows="rows" />')
  })

  it('inserts defineMetadata into an existing script setup', () => {
    const source = `<script setup lang="ts">\nconst rows = []\n</script>\n<template><Table :rows="rows" /></template>`
    const result = patchComponentSFCMetadataSource(source, { 'hub.table': { attributes: ['STA'] } })

    expect(result.ok).toBe(true)
    expect(result.source).toContain('defineMetadata({')
    expect(result.source.indexOf('defineMetadata')).toBeLessThan(result.source.indexOf('const rows'))
    expect(inspectComponentSFCMetadata(result.source).metadata).toEqual({
      'hub.table': { attributes: ['STA'] },
    })
  })

  it('keeps duplicate metadata declarations Source-owned', () => {
    const source = `<script setup lang="ts">\ndefineMetadata({})\ndefineMetadata({ value: true })\n</script>\n<template><Table /></template>`
    const projection = inspectComponentSFCMetadata(source)
    const result = patchComponentSFCMetadataSource(source, {})

    expect(projection.mode).toBe('duplicate')
    expect(projection.editable).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.source).toBe(source)
  })
})
