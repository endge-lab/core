import { describe, expect, it } from 'vitest'

import { EndgeDomain_Module } from '@/modules/domain/EndgeDomain_Module'
import { RType } from '@/modules/domain/entities/RType'

describe('индекс identity типов EndgeDomain', () => {
  it('удаляет старую запись identity после изменения identity модели', () => {
    const domain = new EndgeDomain_Module()
    const type = new RType('Flight')
    type.identity = 'original-flight'
    domain.addType(type)

    type.identity = 'renamed-flight'
    domain.removeTypeById(type.id)

    expect(domain.getTypeById(type.id)).toBeNull()
    expect(domain.getTypeByIdentity('original-flight')).toBeNull()
    expect(domain.getTypeByIdentity('renamed-flight')).toBeNull()
  })
})
