import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/modules/source/services/compilers/composition-source-compile'
import { CompositionSourceLanguageStrategy } from '@/modules/source/services/strategies/CompositionSourceLanguageStrategy'
import { TypeSourceLanguageStrategy } from '@/modules/source/services/strategies/TypeSourceLanguageStrategy'

describe('нормализация языка Source', () => {
  it('канонизирует заключённые в кавычки ссылки Type Source без изменения строковых значений', () => {
    const strategy = new TypeSourceLanguageStrategy()
    const source = `defineType({
  // Keep this author comment.
  customer: field('Customer').description('Customer reference'),
  flights: field(arrayOf(type('Flight'))),
})`

    expect(strategy.normalize(source)).toBe(`defineType({
  // Keep this author comment.
  customer: field(Customer).description('Customer reference'),
  flights: field(arrayOf(Flight)),
})`)
  })

  it('канонизирует только типы полей defineProps в Source Composition', () => {
    const strategy = new CompositionSourceLanguageStrategy()
    const source = `defineComposition({
  props: defineProps({
    customer: field('Customer').optional(),
    label: field('String').default('Keep this value'),
  }),
  runtimes: {
    card: component('CustomerCard').withProps({ label: 'String' }),
  },
})`

    expect(strategy.normalize(source)).toBe(`defineComposition({
  props: defineProps({
    customer: field(Customer).optional(),
    label: field(String).default('Keep this value'),
  }),
  runtimes: {
    card: component('CustomerCard').withProps({ label: 'String' }),
  },
})`)
  })

  it('компилирует типы полей без кавычек в defineProps Composition', () => {
    const source = new CompositionSourceLanguageStrategy().normalize(`defineComposition({
      props: defineProps({ customer: field('Customer').optional() }),
      runtimes: {},
    })`)
    const result = compileCompositionSource(source)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.props).toEqual([
      expect.objectContaining({ key: 'customer', type: 'Customer', optional: true }),
    ])
  })
})
