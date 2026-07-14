import { afterEach, describe, expect, it } from 'vitest'
import { Raph } from '@endge/raph'

import { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import { Endge } from '@/model/endge/kernel/endge'

describe('Endge runtime persistence integration', () => {
  afterEach(() => {
    Endge.runtime.reset()
    Raph.app.reset()
  })

  it('uses explicit runtime id and attaches runtime state controller', () => {
    const host = Endge.runtime.execute(createSFCModel(), {
      id: 'test-runtime',
      persistence: 'disabled',
      target: 'dom',
    }) as ComponentSFCRuntimeHost | null

    expect(host?.id).toBe('test-runtime')
    expect(host?.runtimeState?.runtimeId).toBe('test-runtime')
  })

  it('rejects duplicate active runtime ids and allows reuse after destroy', () => {
    const first = Endge.runtime.execute(createSFCModel('first'), {
      id: 'duplicate-runtime',
      persistence: 'disabled',
      target: 'dom',
    })
    const second = Endge.runtime.execute(createSFCModel('second'), {
      id: 'duplicate-runtime',
      persistence: 'disabled',
      target: 'dom',
    })

    expect(first).not.toBeNull()
    expect(second).toBeNull()

    Endge.runtime.destroyRuntime('duplicate-runtime')

    const third = Endge.runtime.execute(createSFCModel('third'), {
      id: 'duplicate-runtime',
      persistence: 'disabled',
      target: 'dom',
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
