import { describe, expect, it } from 'vitest'

import { resolveCompositionActivation } from '@/model/services/source-engine/composition-activation'

describe('Composition activation precedence', () => {
  it('uses invocation override before child root and owner scope', () => {
    expect(resolveCompositionActivation({ mode: 'startup' }, { mode: 'manual' }, { mode: 'manual' }))
      .toEqual({ mode: 'startup' })
    expect(resolveCompositionActivation({ mode: 'manual' }, { mode: 'startup' }, { mode: 'startup' }))
      .toEqual({ mode: 'manual' })
  })

  it('uses child root before owner scope and then startup default', () => {
    expect(resolveCompositionActivation(null, { mode: 'manual' }, { mode: 'startup' }))
      .toEqual({ mode: 'manual' })
    expect(resolveCompositionActivation(null, null, { mode: 'manual' }))
      .toEqual({ mode: 'manual' })
    expect(resolveCompositionActivation(null, null, null))
      .toEqual({ mode: 'startup' })
  })
})
