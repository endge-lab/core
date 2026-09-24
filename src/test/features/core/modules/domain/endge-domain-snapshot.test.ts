import { describe, expect, it } from 'vitest'

import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'
import { RComposition } from '@/features/core/modules/domain/entities/RComposition'

describe('snapshot домена', () => {
  // Проверяет независимое восстановление Domain через API его владельца.
  it('сериализует и материализует persisted-сущности Domain', () => {
    const source = new EndgeDomain_Module()
    source.addComposition(RComposition.fromPlain({
      id: 101,
      identity: 'airport',
      name: 'Airport',
    }))

    const restored = source.materializeSnapshot(source.toPlain())

    expect(restored).not.toBe(source)
    expect(restored.getCompositionByIdentity('airport')).toMatchObject({
      id: 101,
      identity: 'airport',
      name: 'Airport',
    })
  })

  // Проверяет сохранение правила исключения временных сущностей из snapshot.
  it('не переносит временные сущности', () => {
    const source = new EndgeDomain_Module()
    const temporary = RComposition.fromPlain({
      id: 102,
      identity: 'preview',
      name: 'Preview',
    })
    temporary.isTemporary = true
    source.addComposition(temporary)

    const snapshot = source.toPlain()

    expect(snapshot.compositions).toEqual([])
  })
})
