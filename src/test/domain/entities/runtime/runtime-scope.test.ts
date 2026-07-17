import { describe, expect, it, vi } from 'vitest'

import { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'

function host(id: string, events: string[]): RuntimeHost<any, any> {
  return {
    id,
    status: 'active',
    pause: vi.fn(() => { events.push(`pause:${id}`) }),
    resume: vi.fn(() => { events.push(`resume:${id}`) }),
    reconcile: vi.fn(() => { events.push(`reconcile:${id}`) }),
    stop: vi.fn(() => { events.push(`stop:${id}`) }),
    unmount: vi.fn(() => { events.push(`unmount:${id}`) }),
    destroy: vi.fn(() => { events.push(`destroy:${id}`) }),
  } as unknown as RuntimeHost<any, any>
}

describe('RuntimeScope lifecycle', () => {
  it('serializes activation, pauses children-first and reconciles once after dropped updates', async () => {
    const events: string[] = []
    const parent = new RuntimeScope({
      id: 'parent',
      path: 'parent',
      hooks: {
        activate: async () => { events.push('activate:parent') },
        reconcile: () => { events.push('reconcile:scope') },
      },
    })
    const child = new RuntimeScope({
      id: 'child',
      path: 'child',
      parent,
      hooks: { activate: () => { events.push('activate:child') } },
    })
    parent.addRuntime(host('parent-host', events))
    child.addRuntime(host('child-host', events))

    await Promise.all([parent.activate(), parent.activate()])
    await child.activate()
    await parent.pause()
    parent.markStale()
    await parent.resume()

    expect(events.filter(item => item === 'activate:parent')).toHaveLength(1)
    expect(events.indexOf('pause:child-host')).toBeLessThan(events.indexOf('pause:parent-host'))
    expect(events).toContain('reconcile:scope')
    expect(parent.state).toBe('active')
    expect(child.state).toBe('active')
  })

  it('rolls back resources in reverse order and is idempotent on deactivate', async () => {
    const events: string[] = []
    const scope = new RuntimeScope({ id: 'scope', path: 'scope' })
    scope.resources.add({ id: 'one', kind: 'test', dispose: () => { events.push('dispose:one') } })
    scope.resources.add({ id: 'two', kind: 'test', dispose: () => { events.push('dispose:two') } })
    scope.addRuntime(host('runtime', events))
    await scope.activate()
    await scope.deactivate()
    await scope.deactivate()

    expect(events.slice(-2)).toEqual(['dispose:two', 'dispose:one'])
    expect(scope.snapshot()).toMatchObject({ state: 'inactive', resources: { total: 0 } })
  })

  it('ignores a late activation result after abort by rolling the scope back', async () => {
    let release!: () => void
    const scope = new RuntimeScope({
      id: 'late',
      path: 'late',
      hooks: { activate: () => new Promise<void>((resolve) => {
        release = resolve
      }) },
    })
    const activation = scope.activate()
    await Promise.resolve()
    const deactivation = scope.deactivate()
    await expect(activation).rejects.toMatchObject({ name: 'AbortError' })
    await deactivation
    release()
    await Promise.resolve()
    expect(scope.state).toBe('inactive')
  })

  it('returns resources and runtime membership to baseline after 100 lifecycle cycles', async () => {
    let scope!: RuntimeScope
    let generation = 0
    scope = new RuntimeScope({
      id: 'stress',
      path: 'stress',
      hooks: {
        activate: () => {
          const current = ++generation
          scope.resources.add({ id: `resource:${current}`, kind: 'stress', dispose: () => undefined })
          scope.addRuntime(host(`runtime:${current}`, []))
        },
      },
    })
    for (let index = 0; index < 100; index += 1) {
      await scope.activate()
      await scope.pause()
      await scope.resume()
      await scope.deactivate()
    }
    expect(scope.snapshot()).toMatchObject({
      state: 'inactive',
      memberRuntimeIds: [],
      resources: { total: 0, paused: false },
    })
    await scope.dispose()
    expect(scope.state).toBe('disposed')
  })
})
