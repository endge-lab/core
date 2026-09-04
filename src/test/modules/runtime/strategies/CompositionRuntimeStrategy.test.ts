import { Serialize } from '@endge/utils'
import { describe, expect, it } from 'vitest'

import { RComposition } from '@/modules/domain/entities/RComposition'
import { CompositionRuntimeStrategy } from '@/modules/runtime/services/strategies/CompositionRuntimeStrategy'

describe('проверка Runtime-стратегия Composition', () => {
  const strategy = new CompositionRuntimeStrategy()

  it('поддерживает экземпляры RComposition', () => {
    expect(strategy.supports(new RComposition())).toBe(true)
  })

  it('поддерживает модели Composition, созданные другим экземпляром модуля', () => {
    expect(strategy.supports({ type: 'composition' })).toBe(true)
  })

  it('отклоняет source-first модели без дискриминатора Composition', () => {
    expect(strategy.supports({ source: '', sourceVersion: 1 })).toBe(false)
  })

  it('не сохраняет дискриминатор runtime', () => {
    expect(Serialize.toPlain(new RComposition())).not.toHaveProperty('type')
  })
})
