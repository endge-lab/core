import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'

describe('свойства предварительного просмотра Component SFC', () => {
  it('сохраняет обратную совместимость литерального definePreviewProps', () => {
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

  it('разбирает preview props из Store и настройки preview runtime', () => {
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

  it('разбирает data props из Store и маршрутизированные preview-запуски Query', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{ rows: unknown[] }>()

definePreviewProps(
  {
    rows: fromData('schedule.table'),
  },
  {
    run: [
      query('schedule').storeTo(store('schedule'), {
        raw: output('raw'),
      }),
      query('metadata').storeTo(store('schedule'), 'meta'),
    ],
  },
)
</script>

<template><Table :rows="rows" /></template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(result.previewProps).toEqual({
      rows: { type: 'data', store: 'schedule', path: 'table' },
    })
    expect(result.previewOptions).toEqual({
      run: [
        {
          type: 'query',
          identity: 'schedule',
          storeTo: { store: 'schedule', fields: { raw: 'raw' } },
        },
        {
          type: 'query',
          identity: 'metadata',
          storeTo: { store: 'schedule', fields: { meta: 'meta' } },
        },
      ],
    })
  })
})
