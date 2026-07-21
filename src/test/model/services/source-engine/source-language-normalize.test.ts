import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/model/services/source-engine/compilers/composition-source-compile'
import { CompositionSourceLanguageStrategy } from '@/model/services/source-engine/strategies/CompositionSourceLanguageStrategy'
import { TypeSourceLanguageStrategy } from '@/model/services/source-engine/strategies/TypeSourceLanguageStrategy'

describe('source language normalization', () => {
  it('canonicalizes quoted Type Source references without changing string values', () => {
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

  it('canonicalizes only defineProps field types in Composition Source', () => {
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

  it('compiles bare field types in Composition defineProps', () => {
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
