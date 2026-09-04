import type { ComponentSFCRuntimeHost } from '@/modules/runtime/hosts/ComponentSFCRuntimeHost'
import { Raph } from '@endge/raph'

import { afterEach, describe, expect, it } from 'vitest'
import { Endge } from '@/kernel/endge'
import { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'

describe('интеграция сохранения runtime Endge', () => {
  afterEach(() => {
    Endge.runtime.reset()
    Raph.app.reset()
  })

  it('использует явный ID runtime и подключает контроллер состояния runtime', () => {
    const host = Endge.runtime.execute(createSFCModel(), {
      id: 'test-runtime',
      persistence: 'disabled',
      meta: { target: 'dom' },
    }) as ComponentSFCRuntimeHost | null

    expect(host?.id).toBe('test-runtime')
    expect(host?.runtimeState?.runtimeId).toBe('test-runtime')
    expect(host?.status).toBe('active')
  })

  it('отклоняет дублирующиеся ID активных runtime и разрешает повторное использование после destroy', () => {
    const first = Endge.runtime.execute(createSFCModel('first'), {
      id: 'duplicate-runtime',
      persistence: 'disabled',
      meta: { target: 'dom' },
    })
    const second = Endge.runtime.execute(createSFCModel('second'), {
      id: 'duplicate-runtime',
      persistence: 'disabled',
      meta: { target: 'dom' },
    })

    expect(first).not.toBeNull()
    expect(second).toBeNull()

    Endge.runtime.destroyRuntime('duplicate-runtime')

    const third = Endge.runtime.execute(createSFCModel('third'), {
      id: 'duplicate-runtime',
      persistence: 'disabled',
      meta: { target: 'dom' },
    })

    expect(third?.id).toBe('duplicate-runtime')
  })
})

function createSFCModel(identity = 'test-sfc-runtime'): RComponentSFC {
  return RComponentSFC.fromPlain({
    id: identity,
    identity,
    name: identity,
    source: `<template><Text>Test</Text></template>`,
  })
}
