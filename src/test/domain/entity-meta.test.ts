import { describe, expect, it } from 'vitest'

import { normalizeEntityMeta, REntity } from '@/domain/entities/reflect/REntity'

describe('REntity metadata', () => {
  it('defaults invalid or missing metadata to an empty object', () => {
    expect(normalizeEntityMeta(undefined)).toEqual({})
    expect(normalizeEntityMeta(null)).toEqual({})
    expect(normalizeEntityMeta([])).toEqual({})
  })

  it('clones transport metadata through the common entity parser', () => {
    const source = { table: { attributes: ['STA'] } }
    const entity = new REntity()

    entity.applyEntityMeta({ meta: source })

    expect(entity.meta).toEqual(source)
    expect(entity.meta).not.toBe(source)
  })
})
