import { describe, expect, it } from 'vitest'

import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'
import { RProject } from '@/features/core/modules/domain/entities/RProject'

describe('snapshot домена', () => {
  /** Проверяет независимое восстановление Domain через API его владельца. */
  it('сериализует и материализует persisted-сущности Domain', () => {
    const source = new EndgeDomain_Module()
    source.addProject(RProject.fromPlain({
      id: 101,
      identity: 'airport',
      name: 'Airport',
    }))

    const restored = source.materializeSnapshot(source.toPlain())

    expect(restored).not.toBe(source)
    expect(restored.getProjectByIdentity('airport')).toMatchObject({
      id: 101,
      identity: 'airport',
      name: 'Airport',
    })
  })

  /** Проверяет сохранение правила исключения временных сущностей из snapshot. */
  it('не переносит временные сущности', () => {
    const source = new EndgeDomain_Module()
    const temporary = RProject.fromPlain({
      id: 102,
      identity: 'preview',
      name: 'Preview',
    })
    temporary.isTemporary = true
    source.addProject(temporary)

    const snapshot = source.toPlain()

    expect(snapshot.projects).toEqual([])
  })
})
