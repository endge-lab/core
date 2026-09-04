import { describe, expect, it } from 'vitest'

import { normalizeEntityMeta, REntity } from '@/modules/domain/entities/REntity'

describe('метаданные REntity', () => {
  it('заменяет невалидные или отсутствующие метаданные пустым объектом', () => {
    expect(normalizeEntityMeta(undefined)).toEqual({})
    expect(normalizeEntityMeta(null)).toEqual({})
    expect(normalizeEntityMeta([])).toEqual({})
  })

  it('клонирует transport-метаданные через общий parser сущностей', () => {
    const source = { table: { attributes: ['STA'] } }
    const entity = new REntity()

    entity.applyEntityMeta({ meta: source })

    expect(entity.meta).toEqual(source)
    expect(entity.meta).not.toBe(source)
  })
})
