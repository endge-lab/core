import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { FilterProgramPayload } from '@/features/core/modules/source/domain/types/filter-source.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RFilter } from '@/features/core/modules/domain/entities/RFilter'
import { FilterRuntimeHost } from '@/features/core/modules/runtime/hosts/FilterRuntimeHost'
import { compileFilterSource } from '@/features/core/modules/source/services/compilers/filter-source-compile'

describe('проверка Host runtime для Filter', () => {
  afterEach(() => {
    vi.useRealTimers()
    Raph.app.reset()
  })

  it('разделяет одно состояние через Actions и считает каждый action новым поколением output', async () => {
    const host = createHost()
    const changed: string[] = []
    const eventOrder: string[] = []
    host.on('output:change', (event: any) => changed.push(event.key))
    host.on('state:change', () => eventOrder.push('state'))
    host.on('output:change', (event: any) => eventOrder.push(`output:${event.key}`))

    expect(host.getState()).toEqual({ search: '', codes: [] })
    await host.action('patch').run({ search: 'SU' })
    expect(host.getState()).toEqual({ search: 'SU', codes: [] })
    expect((host.getOutput('request') as any).value).toEqual({ where: { search: 'SU' } })
    expect(changed).toEqual(['request'])
    expect(eventOrder).toEqual(['state', 'output:request'])

    changed.length = 0
    await host.action('set').run({ key: 'search', value: 'SU' })
    expect(changed).toEqual(['request'])

    await host.action('clear').run()
    expect(host.getState()).toEqual({})
    await host.action('reset').run()
    expect(host.getState()).toEqual({ search: '', codes: [] })
  })

  it('повторно вычисляет стандартные относительные даты при reset', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T12:00:00Z'))
    const host = createHost(`
defineFilter({
  fields: { from: field('Date').default(relativeDate('-1d')) },
  outputs: { request: output().json(({ value }) => ({ from: value('from') })) },
})
`)
    expect(host.getState()).toEqual({ from: '2026-07-09' })
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'))
    await host.action('reset').run()
    expect(host.getState()).toEqual({ from: '2026-07-11' })
  })

  it('повторно вычисляет стандартные относительные дату и время при reset', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T12:34:56.789Z'))
    const host = createHost(`
defineFilter({
  fields: {
    from: field('DateTime').default(relativeDateTime('-7d', 'startOfDay')),
    to: field('DateTime').default(relativeDateTime('+0d', 'endOfDay')),
    now: field('DateTime').default(relativeDateTime('+0d')),
  },
  outputs: { request: output().json(({ value }) => ({ from: value('from'), to: value('to'), now: value('now') })) },
})
`)
    expect(host.getState()).toEqual({
      from: '2026-07-03T00:00:00.000Z',
      to: '2026-07-10T23:59:59.999Z',
      now: '2026-07-10T12:34:56.789Z',
    })

    vi.setSystemTime(new Date('2026-07-12T01:02:03.004Z'))
    await host.action('reset').run()
    expect(host.getState()).toEqual({
      from: '2026-07-05T00:00:00.000Z',
      to: '2026-07-12T23:59:59.999Z',
      now: '2026-07-12T01:02:03.004Z',
    })
  })

  it('отклоняет неизвестные поля и некорректные значения', async () => {
    const host = createHost()
    await expect(host.action('patch').run({ unknown: true })).rejects.toThrow('unknown field')
    await expect(host.action('set').run({ key: 'search', value: 42 })).rejects.toThrow('invalid value')
  })

  it('принимает строковые значения полей Time и отклоняет нестроковые', async () => {
    const host = createHost(`
defineFilter({
  fields: { departureTime: field('Time').default('06:30') },
  outputs: { request: output().json(({ value }) => ({ departureTime: value('departureTime') })) },
})
`)

    expect(host.getState()).toEqual({ departureTime: '06:30' })
    await host.action('set').run({ key: 'departureTime', value: '12:45' })
    expect(host.getState()).toEqual({ departureTime: '12:45' })
    await expect(host.action('set').run({ key: 'departureTime', value: 1245 })).rejects.toThrow('invalid value')
  })

  it('инвалидирует только outputs, зависящие от изменённых полей', async () => {
    const host = createHost(`
defineFilter({
  fields: {
    search: field('String').default(''),
    from: field('DateTime').optional(),
  },
  outputs: {
    search: output().json(({ value }) => lowerCase(trim(value('search')))),
    request: output().json(({ value }) => compact({ from: value('from') })),
  },
})
`)
    const changed: string[] = []
    host.on('output:change', (event: any) => changed.push(event.key))

    await host.action('set').run({ key: 'search', value: '  SU  ' })

    expect(changed).toEqual(['search'])
    expect((host.getOutput('search') as any).value).toBe('su')
  })
})

function createHost(source = `
defineFilter({
  fields: {
    search: field('String').optional().default(''),
    codes: field('String').array().default([]),
  },
  outputs: {
    request: output().json(({ value }) => compact({ where: { search: value('search') } })),
  },
})
`): FilterRuntimeHost {
  const payload = compileFilterSource(source).artifact!
  const artifact: ProgramArtifact<FilterProgramPayload> = {
    ref: { entityType: 'filter', id: 1, identity: 'test-filter' },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable', 'data-provider', 'configuration'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
  const model = new RFilter()
  model.id = 1
  model.identity = 'test-filter'
  model.name = 'Test Filter'
  model.displayName = 'Test Filter'
  const host = FilterRuntimeHost.createRuntime({
    id: 'filter-runtime',
    model,
    artifacts: { getArtifact: () => artifact as any },
  })
  if (!host) {
    throw new Error('Filter host was not created')
  }
  return host
}
