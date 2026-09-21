import { describe, expect, it } from 'vitest'

import { collectTypeExpressionReferences } from '@/features/core/modules/compiler/services/type/type-program-validation'

describe('проверка программы Type', () => {
  it('не считает имена свойств объекта с заглавной буквы ссылками Type Registry', () => {
    expect(collectTypeExpressionReferences(`Array<{
      id: number
      Q: string
      optionalQ?: string
      status: TelegraphStatus
    }>`)).toEqual(new Set(['TelegraphStatus']))
  })
})
