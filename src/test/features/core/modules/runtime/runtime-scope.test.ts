import type { RuntimeHost } from '@/features/core/modules/runtime/domain/runtime-host.types'

import { describe, expect, it, vi } from 'vitest'
import { RuntimeScope } from '@/features/core/modules/runtime/RuntimeScope'

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

describe('жизненный цикл RuntimeScope', () => {
  it('последовательно выполняет активацию, приостанавливает сначала детей и один раз согласует состояние после пропущенных обновлений', async () => {
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

  /** Восстановление ребёнка не занимает его очередь до восстановления предка. */
  it('возобновляет остановленное дерево через ребёнка без взаимного ожидания', async () => {
    const parent = new RuntimeScope({ id: 'parent', path: 'parent' })
    const child = new RuntimeScope({ id: 'child', path: 'child', parent })
    await child.activate()
    await parent.pause()
    await child.activate()
    expect(parent.state).toBe('active')
    expect(child.state).toBe('active')
    await parent.pause()
    await child.resume()
    expect(parent.state).toBe('active')
    expect(child.state).toBe('active')
    await parent.dispose()
  })

  /** Startup hook родителя может активировать того же ребёнка, который запросил запуск. */
  it('активирует startup ребёнка через неактивного родителя без цикла очередей', async () => {
    let child: RuntimeScope
    const parent: RuntimeScope = new RuntimeScope({
      id: 'parent',
      path: 'parent',
      hooks: { activate: () => child.activate() },
    })
    child = new RuntimeScope({ id: 'child', path: 'child', parent })
    await child.activate()
    expect(parent.state).toBe('active')
    expect(child.state).toBe('active')
    await parent.dispose()
  })

  it('откатывает ресурсы в обратном порядке и идемпотентно выполняет deactivate', async () => {
    const events: string[] = []
    const scope = new RuntimeScope({ id: 'scope', path: 'scope' })
    scope.resources.add({ id: 'one', kind: 'test', dispose: () => {
      events.push('dispose:one')
    } })
    scope.resources.add({ id: 'two', kind: 'test', dispose: () => {
      events.push('dispose:two')
    } })
    scope.addRuntime(host('runtime', events))
    await scope.activate()
    await scope.deactivate()
    await scope.deactivate()

    expect(events.slice(-2)).toEqual(['dispose:two', 'dispose:one'])
    expect(scope.snapshot()).toMatchObject({ state: 'inactive', resources: { total: 0 } })
  })

  it('отменяет ожидающий resume до повторного запуска hosts', async () => {
    let release!: () => void
    const member = host('member', [])
    const scope = new RuntimeScope({ id: 'resuming', path: 'resuming', hooks: {
      resume: () => new Promise<void>((resolve) => {
        release = resolve
      }),
    } })
    scope.addRuntime(member)
    await scope.activate()
    await scope.pause()
    const resuming = scope.resume()
    const rejected = expect(resuming).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await scope.deactivate()
    await rejected
    release()
    expect(member.resume).not.toHaveBeenCalled()
    expect(scope.state).toBe('inactive')
  })

  it('отменяет активацию, ещё не начавшую выполняться в очереди', async () => {
    const activate = vi.fn(() => new Promise<void>(() => {}))
    const scope = new RuntimeScope({ id: 'queued', path: 'queued', hooks: { activate } })
    const activation = scope.activate()
    const deactivation = scope.deactivate()
    await expect(activation).rejects.toMatchObject({ name: 'AbortError' })
    await deactivation
    expect(activate).not.toHaveBeenCalled()
    expect(scope.state).toBe('inactive')
  })

  it('игнорирует поздний результат активации после abort, откатывая scope', async () => {
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

  it('возвращает ресурсы и состав runtime к исходному состоянию после 100 циклов lifecycle', async () => {
    let generation = 0
    const scope = new RuntimeScope({
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
    await expect(scope.deactivate()).resolves.toBeUndefined()
    expect(scope.state).toBe('disposed')
  })
})
