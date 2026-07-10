import type { FilterProgramPayload } from '@/domain/types/filter-source.types'
import type { ProgramArtifact } from '@/domain/types/program.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RFilter } from '@/domain/entities/reflect/RFilter'
import { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import { compileFilterSource } from '@/domain/services/source-engine/filter-source-compile'

describe('FilterRuntimeHost', () => {
  afterEach(() => {
    vi.useRealTimers()
    Raph.app.reset()
  })

  it('shares one state through commands and emits only structurally changed outputs', async () => {
    const host = createHost()
    const changed: string[] = []
    const eventOrder: string[] = []
    host.on('output:change', (event: any) => changed.push(event.key))
    host.on('state:change', () => eventOrder.push('state'))
    host.on('output:change', (event: any) => eventOrder.push(`output:${event.key}`))

    expect(host.getState()).toEqual({ search: '', codes: [] })
    await host.command('patch').run({ search: 'SU' })
    expect(host.getState()).toEqual({ search: 'SU', codes: [] })
    expect((host.getOutput('request') as any).value).toEqual({ where: { search: 'SU' } })
    expect(changed).toEqual(['request'])
    expect(eventOrder).toEqual(['state', 'output:request'])

    changed.length = 0
    await host.command('set').run({ key: 'search', value: 'SU' })
    expect(changed).toEqual([])

    await host.command('clear').run()
    expect(host.getState()).toEqual({})
    await host.command('reset').run()
    expect(host.getState()).toEqual({ search: '', codes: [] })
  })

  it('re-evaluates relative date defaults on reset', async () => {
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
    await host.command('reset').run()
    expect(host.getState()).toEqual({ from: '2026-07-11' })
  })

  it('re-evaluates relative date-time defaults on reset', async () => {
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
    await host.command('reset').run()
    expect(host.getState()).toEqual({
      from: '2026-07-05T00:00:00.000Z',
      to: '2026-07-12T23:59:59.999Z',
      now: '2026-07-12T01:02:03.004Z',
    })
  })

  it('rejects unknown fields and invalid values', async () => {
    const host = createHost()
    await expect(host.command('patch').run({ unknown: true })).rejects.toThrow('unknown field')
    await expect(host.command('set').run({ key: 'search', value: 42 })).rejects.toThrow('invalid value')
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
  if (!host)
    throw new Error('Filter host was not created')
  return host
}
