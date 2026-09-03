import { describe, expect, it } from 'vitest'

import { RType } from '@/domain/entities/reflect/RType'
import { EndgeDomain_Module } from '@/model/modules/domain/EndgeDomain_Module'

describe('endgeDomain type identity index', () => {
  it('removes the old identity entry after the model identity was changed', () => {
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
