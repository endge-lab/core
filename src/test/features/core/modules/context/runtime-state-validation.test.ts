import type { EndgeStorageAdapter } from '@/features/core/modules/context/domain/context-persistence.types'
import { describe, expect, it, vi } from 'vitest'
import { RuntimeStateController } from '@/features/core/modules/context/persistence/RuntimeStateController'

const scope = { workspaceId: 'w', tenantId: 't', projectId: 'p', environmentId: 'e', userId: 'u' }

function storage(initial?: unknown) {
  let value = initial
  const adapter: EndgeStorageAdapter = {
    id: 'local',
    isAvailable: () => true,
    read: <T>() => value as T,
    write: (_key, next) => { value = JSON.parse(JSON.stringify(next)) },
    remove: () => { value = undefined },
  }
  return adapter
}

function controller(adapter: EndgeStorageAdapter, runtimeId = 'runtime') {
  return new RuntimeStateController({ runtimeId, storageId: 'stable', scope, adapter })
}

describe('безопасное восстановление RuntimeState', () => {
  /** Специальные имена должны переживать JSON round-trip без изменения общих объектов. */
  it.each(['__proto__', 'constructor', 'toString'])('изолирует ключ %s на обоих уровнях словаря', (key) => {
    const state = controller(storage())
    const before = Object.getOwnPropertyDescriptors(Object.prototype)
    state.set(key, 'auditMarker', 'entity')
    state.set('other', key, { marker: 'section' })
    expect(state.get(key, 'auditMarker', null)).toBe('entity')
    expect(state.get('other', key, null)).toEqual({ marker: 'section' })
    expect(state.get('missing', key, 'fallback')).toBe('fallback')
    state.remove(key, 'auditMarker')
    state.remove('other', key)
    expect(state.get(key, 'auditMarker', 'fallback')).toBe('fallback')
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(before)
  })

  /** Повреждённая оболочка cache не должна мешать mount и последующей записи. */
  it.each([null, [], 1, {}, { version: 1 }, { version: 2, state: {} }, { version: 1, state: [] }])(
    'восстанавливает defaults для несовместимого snapshot %#',
    (snapshot) => {
      const state = controller(storage(snapshot))
      expect(state.get('filter:main', 'state', { limit: 10 })).toEqual({ limit: 10 })
      state.set('filter:main', 'state', { limit: 20 })
      expect(state.get('filter:main', 'state', null)).toEqual({ limit: 20 })
    },
  )

  it('пропускает повреждённые секции, сохраняя исправные и стабильный storageId', () => {
    const adapter = storage({ version: 1, runtimeId: 'old', scope, state: { bad: 42, good: { state: { limit: 3 } } } })
    const state = controller(adapter, 'new')
    expect(state.get('bad', 'state', 'fallback')).toBe('fallback')
    expect(state.get('good', 'state', null)).toEqual({ limit: 3 })
  })

  it('не восстанавливает snapshot другого контекста даже при ошибке адаптера', () => {
    const state = controller(storage({ version: 1, runtimeId: 'old', scope: { ...scope, userId: 'other' }, state: { filter: { state: 'foreign' } } }))
    expect(state.get('filter', 'state', 'fallback')).toBe('fallback')
  })

  it('возвращает defaults при ошибке чтения адаптера', () => {
    const adapter = storage()
    vi.spyOn(adapter, 'read').mockImplementation(() => {
      throw new Error('broken JSON')
    })
    expect(controller(adapter).get('filter', 'state', 'fallback')).toBe('fallback')
  })
})
