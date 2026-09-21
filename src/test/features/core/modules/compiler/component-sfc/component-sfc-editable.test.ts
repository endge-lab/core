import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-compile'

describe('компилятор редактируемого поведения Component SFC', () => {
  it('компилирует редактируемое поведение примитива и синтезирует порт edited', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{ status: string }>()
</script>
<template>
  <Text :value="status" editable edit-on="dblclick" />
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const node = result.ir?.template.roots[0]
    expect(node).toMatchObject({
      kind: 'element',
      tag: 'Text',
      editable: {
        value: { kind: 'expression', source: 'status' },
        triggers: { kind: 'literal', value: 'dblclick' },
      },
    })
    expect(result.ir?.script.ports.emits.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'edited', payloadType: 'unknown' }),
    ]))
  })

  it('принимает TriggerSet Configuration через $context.config', () => {
    const result = compileComponentSFC(`<template>
  <DateTime
    value="2026-08-20T12:00:00Z"
    editable
    :edit-on="$context.config.groundHandling.actualTimeTriggers"
  />
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const node = result.ir?.template.roots[0]
    expect(node?.kind === 'element' ? node.editable?.triggers : null).toMatchObject({
      kind: 'expression',
      source: '$context.config.groundHandling.actualTimeTriggers',
    })
  })

  it('компилирует лексический scope строки и вычисляемый ключ patch в emit()', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{ rows: Array<{ id: number, status: string }> }>()
</script>
<template>
  <Table :rows="rows" row-key="id">
    <Column key="status">
      <Text
        :value="value"
        editable
        @edited="emit('edited', { id: rowKey, patch: { [columnKey]: event('value') } })"
      />
    </Column>
  </Table>
</template>`)

    expect(result.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    const table = result.ir?.template.roots[0]
    const column = table?.kind === 'element' ? table.children[0] : null
    const text = column?.kind === 'element' ? column.children[0] : null
    expect(text?.kind === 'element' ? text.events?.[0]?.action : null).toMatchObject({
      kind: 'emit',
      event: 'edited',
      payload: {
        kind: 'object',
        entries: expect.arrayContaining([
          expect.objectContaining({ key: 'id', value: { kind: 'scope', path: 'rowKey' } }),
          expect.objectContaining({ key: 'patch' }),
        ]),
      },
    })
  })

  it('проверяет явный компонент и варианты Editable', () => {
    const valid = compileComponentSFC(`<template>
  <Variant name="default"><Text>View</Text></Variant>
  <Variant name="edit"><Input value="Edit" /></Variant>
</template>`)
    expect(valid.diagnostics.filter(item => item.severity === 'error')).toEqual([])
    expect(valid.ir?.template.variants?.map(item => item.name)).toEqual(['default', 'edit'])

    const invalid = compileComponentSFC(`<template>
  <Editable value="A">
    <Variant name="default"><Text>A</Text></Variant>
  </Editable>
</template>`)
    expect(invalid.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-variant-edit-required', severity: 'error' }),
    ]))
  })

  it('отклоняет смешанные дочерние узлы Text, если value нельзя вывести', () => {
    const result = compileComponentSFC(`<script setup lang="ts">defineProps<{ status: string }>()</script>
<template><Text editable>Status: {{ status }}</Text></template>`)
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-editable-text-value', severity: 'error' }),
    ]))
  })

  it('требует вариант edit у зависимости редактируемого пользовательского компонента', () => {
    const result = compileComponentSFC(`<template><MyStatus value="RUN" editable /></template>`, {
      resolveComponentTag: tag => tag === 'MyStatus' ? 'MyStatus' : null,
      resolveComponentVariants: identity => identity === 'MyStatus' ? ['default'] : null,
    })

    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'sfc-editable-component-variant-missing', severity: 'error' }),
    ]))
  })
})
