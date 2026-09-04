import { describe, expect, it } from 'vitest'

import { Endge } from '@/kernel/endge'
import { DomainSnapshotCodec } from '@/modules/domain-repository/services/DomainSnapshotCodec'
import { EndgeDomain_Module } from '@/modules/domain/EndgeDomain_Module'
import { RProject } from '@/modules/domain/entities/RProject'

describe('кодек snapshot домена', () => {
  /** Проверяет независимое восстановление Domain через единый локальный codec. */
  it('сериализует и десериализует persisted-сущности Domain', () => {
    const codec = Endge.domainSnapshot
    const source = new EndgeDomain_Module()
    source.addProject(RProject.fromPlain({
      id: 101,
      identity: 'airport',
      name: 'Airport',
    }))

    const restored = codec.deserialize(codec.serialize(source))

    expect(restored).not.toBe(source)
    expect(restored.getProjectByIdentity('airport')).toMatchObject({
      id: 101,
      identity: 'airport',
      name: 'Airport',
    })
  })

  /** Проверяет сохранение правила исключения временных сущностей из snapshot. */
  it('не переносит временные сущности', () => {
    const codec = new DomainSnapshotCodec(snapshot => EndgeDomain_Module.fromPlain(snapshot))
    const source = new EndgeDomain_Module()
    const temporary = RProject.fromPlain({
      id: 102,
      identity: 'preview',
      name: 'Preview',
    })
    temporary.isTemporary = true
    source.addProject(temporary)

    const snapshot = codec.serialize(source)

    expect(codec).toBeInstanceOf(DomainSnapshotCodec)
    expect(snapshot.projects).toEqual([])
  })
})
