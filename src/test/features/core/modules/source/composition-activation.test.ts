import { describe, expect, it } from 'vitest'

import { resolveCompositionActivation } from '@/features/core/modules/source/services/composition-activation'

describe('приоритет активации Composition', () => {
  it('использует переопределение вызова раньше дочернего корня и scope владельца', () => {
    expect(resolveCompositionActivation({ mode: 'startup' }, { mode: 'manual' }, { mode: 'manual' }))
      .toEqual({ mode: 'startup' })
    expect(resolveCompositionActivation({ mode: 'manual' }, { mode: 'startup' }, { mode: 'startup' }))
      .toEqual({ mode: 'manual' })
  })

  it('использует дочерний корень раньше scope владельца, а затем стартового значения по умолчанию', () => {
    expect(resolveCompositionActivation(null, { mode: 'manual' }, { mode: 'startup' }))
      .toEqual({ mode: 'manual' })
    expect(resolveCompositionActivation(null, null, { mode: 'manual' }))
      .toEqual({ mode: 'manual' })
    expect(resolveCompositionActivation(null, null, null))
      .toEqual({ mode: 'startup' })
  })
})
