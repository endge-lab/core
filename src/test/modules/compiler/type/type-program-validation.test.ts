import { describe, expect, it } from 'vitest'

import { collectTypeExpressionReferences } from '@/modules/compiler/services/type/type-program-validation'

describe('type program validation', () => {
  it('does not treat uppercase object property names as Type Registry references', () => {
    expect(collectTypeExpressionReferences(`Array<{
      id: number
      Q: string
      optionalQ?: string
      status: TelegraphStatus
    }>`)).toEqual(new Set(['TelegraphStatus']))
  })
})
