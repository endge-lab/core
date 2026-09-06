import { describe, expect, it } from 'vitest'

import { UpdateSourceLanguageStrategy } from '@/features/core/modules/source/services/strategies/UpdateSourceLanguageStrategy'

describe('языковая стратегия условного Update Source', () => {
  it('предлагает Meta, existence reads, value, when и общий ValueExpression', () => {
    const labels = new UpdateSourceLanguageStrategy().completions({ source: '' }).map(item => item.label)
    expect(labels).toEqual(expect.arrayContaining([
      'meta target',
      'meta',
      'hasMeta',
      'data',
      'hasData',
      'input',
      'item',
      'parent',
      'value',
      'when',
      'eq',
      '.get',
    ]))
  })
})
