import { Serialize } from '@endge/utils'
import { describe, expect, it } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { CompositionRuntimeStrategy } from '@/model/services/runtime/strategies/CompositionRuntimeStrategy'

describe('CompositionRuntimeStrategy', () => {
  const strategy = new CompositionRuntimeStrategy()

  it('supports RComposition instances', () => {
    expect(strategy.supports(new RComposition())).toBe(true)
  })

  it('supports composition models created by another module instance', () => {
    expect(strategy.supports({ type: 'composition' })).toBe(true)
  })

  it('rejects source-first models without the composition discriminator', () => {
    expect(strategy.supports({ source: '', sourceVersion: 1 })).toBe(false)
  })

  it('does not persist the runtime discriminator', () => {
    expect(Serialize.toPlain(new RComposition())).not.toHaveProperty('type')
  })
})
