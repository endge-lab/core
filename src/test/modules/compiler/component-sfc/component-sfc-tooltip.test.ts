import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/modules/compiler/services/component-sfc/component-sfc-compile'
import { analyzeComponentSFCRuntimeDependencies } from '@/modules/compiler/services/component-sfc/component-sfc-dependencies'

describe('проверка Tooltip в Component SFC', () => {
  it('компилирует текстовую, markdown- и rich-формы в независимое от renderer дерево', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{ help: string }>()
</script>
<template>
  <Flex>
    <Tooltip :text="help"><Text>Text</Text></Tooltip>
    <Tooltip :markdown="help"><Icon name="help" /></Tooltip>
    <Tooltip>
      <TooltipTrigger><Badge>Rich</Badge></TooltipTrigger>
      <TooltipContent><Flex><Text>{{ help }}</Text></Flex></TooltipContent>
    </Tooltip>
  </Flex>
</template>`)

    expect(result.diagnostics.filter(item => item.code.startsWith('sfc-tooltip'))).toEqual([])
    const root = result.ir?.template.roots[0]
    expect(root).toMatchObject({ kind: 'element', tag: 'Flex' })
    if (root?.kind !== 'element') {
      throw new Error('Flex root expected')
    }
    expect(root.children.map(node => node.kind === 'element' ? node.tag : node.kind)).toEqual([
      'Tooltip',
      'Tooltip',
      'Tooltip',
    ])
  })

  it('сохраняет зависимости из ленивого rich-содержимого', () => {
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<{ row: FlightRow }>()
</script>
<template>
  <Tooltip>
    <TooltipTrigger><Text>{{ row.status }}</Text></TooltipTrigger>
    <TooltipContent><Text>{{ row.description }}</Text></TooltipContent>
  </Tooltip>
</template>`)

    expect(result.ir?.template.roots[0]).toMatchObject({ kind: 'element', tag: 'Tooltip' })
    expect(analyzeComponentSFCRuntimeDependencies(result.ir).props).toEqual(expect.arrayContaining([
      expect.objectContaining({ prop: 'row', path: ['status'] }),
      expect.objectContaining({ prop: 'row', path: ['description'] }),
    ]))
  })

  it('отклоняет неоднозначные, некорректные и вложенные структуры tooltip', () => {
    const ambiguous = compileComponentSFC(`<template><Tooltip text="A" markdown="B"><Text>X</Text></Tooltip></template>`)
    const malformed = compileComponentSFC(`<template><Tooltip><TooltipTrigger><Text>X</Text></TooltipTrigger></Tooltip></template>`)
    const nested = compileComponentSFC(`<template><Tooltip><TooltipTrigger><Text>X</Text></TooltipTrigger><TooltipContent><Tooltip text="Y"><Text>Z</Text></Tooltip></TooltipContent></Tooltip></template>`)

    expect(ambiguous.diagnostics.some(item => item.code === 'sfc-tooltip-mode')).toBe(true)
    expect(malformed.diagnostics.some(item => item.code === 'sfc-tooltip-compound-shape')).toBe(true)
    expect(nested.diagnostics.some(item => item.code === 'sfc-tooltip-nested')).toBe(true)
  })

  it('сохраняет сокращённый tooltip как ленивый prop renderer', () => {
    const result = compileComponentSFC(`<template><Badge tooltip="Ready">OK</Badge></template>`)
    expect(result.ir?.template.roots[0]).toMatchObject({
      kind: 'element',
      tag: 'Badge',
      props: { tooltip: { kind: 'literal', value: 'Ready' } },
    })
  })
})
