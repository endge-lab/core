import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/domain/services/compiler/component-sfc-compile'

describe('Component SFC preview props', () => {
  it('keeps literal definePreviewProps backwards-compatible', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  rows: unknown[]
}>()

definePreviewProps({
  rows: [
    {
      id: 'row-1',
      name: 'First row',
    },
  ],
})
</script>

<template>
  <Table :rows="rows" row-key="id">
    <Column key="name" title="Name">
      <Cell><Text>{{ row.name }}</Text></Cell>
    </Column>
  </Table>
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.previewProps).toEqual({
      rows: [
        {
          id: 'row-1',
          name: 'First row',
        },
      ],
    })
    expect(result.previewOptions).toBeNull()
  })

  it('parses store-backed preview props and preview runtime options', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{
  rows: unknown[]
}>()

definePreviewProps(
  {
    rows: fromStore('queries.schedule.ShadowDataview'),
  },
  {
    seed: {
      'queries.schedule.ShadowDataview': [
        {
          id: 'row-1',
          name: 'First row',
        },
      ],
    },
    run: [
      query('schedule'),
    ],
  },
)
</script>

<template>
  <Table :rows="rows" row-key="id">
    <Column key="name" title="Name">
      <Cell><Text>{{ row.name }}</Text></Cell>
    </Column>
  </Table>
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.previewProps).toEqual({
      rows: {
        type: 'store',
        path: 'queries.schedule.ShadowDataview',
      },
    })
    expect(result.previewOptions).toEqual({
      seed: {
        'queries.schedule.ShadowDataview': [
          {
            id: 'row-1',
            name: 'First row',
          },
        ],
      },
      run: [
        {
          type: 'query',
          identity: 'schedule',
        },
      ],
    })
  })
})
