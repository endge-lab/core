import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  Raph,
  RaphDerivedNode,
  RaphDerivedTargetWriteError,
} from '@endge/raph'

import { RConverter } from '@/domain/entities/reflect/RConverter'
import { RFilter } from '@/domain/entities/reflect/RFilter'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import type { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'
import { Endge } from '@/model/endge/kernel/endge'
import { timeStringToDate } from '@/model/seed/converters/date/time-string-to-date'
import { weekdaysRange } from '@/model/seed/converters/date/weekdays-range'

describe('Query Raph derived integration', () => {
  beforeEach(() => {
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
    Raph.app.kernel.clear()
    registerConverter(1, 'time-string-to-date', timeStringToDate)
    registerConverter(2, 'weekdays-range', weekdaysRange)
    compileScheduleFilter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Endge.runtime.reset()
    Endge.program.clear()
    Endge.domain.reset()
    Raph.app.reset()
    Raph.app.kernel.clear()
  })

  it('compiles auto strategy and materializes full/incremental schedule outputs', async () => {
    const query = createScheduleQuery('schedule-derived')
    const artifact = Endge.compiler.buildQuery(query)
    expect(artifact.status).toBe('valid')
    expect(artifact.payload.outputs).toMatchObject([
      { key: 'raw', materialization: { kind: 'source' } },
      { key: 'table', materialization: { kind: 'derived', strategy: { kind: 'collection-by-key', key: 'id' } } },
    ])
    expect(artifact.children?.filter(child => child.ref.entityType === 'data-view')).toHaveLength(1)

    const firstRows = [scheduleRow(1, 'SU', '100'), scheduleRow(2, 'FV', '200')]
    vi.spyOn(Endge.query, 'executeArtifact').mockResolvedValue(firstRows)
    const host = Endge.runtime.execute(query, {
      id: 'schedule-runtime',
      persistence: 'disabled',
      props: { filterPayload: { where: { active: true } } },
    }) as QueryRuntimeHost
    const rawPath = host.outputPath('raw')
    const tablePath = host.outputPath('table')
    const changed: string[] = []
    host.on('output:change', (event: any) => changed.push(event.key))

    const outputs = await host.run()
    expect(outputs.raw).toEqual(firstRows)
    expect(outputs.table).toHaveLength(2)
    expect((outputs.table as any[])[0]).toMatchObject({ id: 1, flightCarrier: 'SU', flightNumber: '100' })
    expect((outputs.table as any[])[0].arrivalTime).toBeInstanceOf(Date)
    expect((outputs.table as any[])[0].daysOfWeek).toEqual([true, true, true, true, true, false, false])
    expect(Raph.get(rawPath)).toEqual(firstRows)
    expect(Raph.get(tablePath)).toEqual(outputs.table)

    const node = host.node?.children.find(child => child instanceof RaphDerivedNode) as RaphDerivedNode
    expect(node).toBeInstanceOf(RaphDerivedNode)
    expect(node.snapshot()).toMatchObject({ strategy: 'collection-by-key', fullComputeCount: 1, incrementalComputeCount: 0 })
    expect(changed).toEqual(['raw', 'table'])

    changed.length = 0
    Raph.set(`${rawPath}[id=1].flightNumber`, '101')
    expect((host.getOutput('table') as any[])[0].flightNumber).toBe('101')
    expect(node.snapshot().incrementalComputeCount).toBe(1)
    await waitForRuntimeTick()
    expect(changed).toContain('table')

    Raph.transaction(() => {
      Raph.merge(`${rawPath}[id=2]`, { departureGate: 'B2' })
      Raph.set(`${rawPath}[id=3]`, scheduleRow(3, 'DP', '300'))
    })
    expect(Raph.get(`${tablePath}[id=2]`)).toMatchObject({ id: 2 })
    expect(Raph.get(`${tablePath}[id=3]`)).toMatchObject({ id: 3, flightNumber: '300' })
    expect(node.snapshot().incrementalComputeCount).toBe(2)

    Raph.delete(`${rawPath}[id=1]`)
    expect(Raph.get(`${tablePath}[id=1]`)).toBeUndefined()
    expect(() => Raph.set(tablePath, [])).toThrow(RaphDerivedTargetWriteError)

    const reordered = [scheduleRow(3, 'DP', '301'), scheduleRow(2, 'FV', '201')]
    Raph.set(rawPath, reordered)
    expect((host.getOutput('table') as any[]).map(row => row.id)).toEqual([3, 2])
    expect(node.snapshot().fullComputeCount).toBe(2)

    vi.mocked(Endge.query.executeArtifact).mockResolvedValue([scheduleRow(4, 'SU', '400')])
    await host.run()
    expect(node.snapshot().fullComputeCount).toBe(3)

    const secondHost = Endge.runtime.execute(query, {
      id: 'schedule-runtime-conflict',
      persistence: 'disabled',
      props: { filterPayload: {} },
    }) as QueryRuntimeHost
    expect(secondHost).toBeTruthy()
    Endge.runtime.destroyRuntimeTree(secondHost.id)

    Endge.runtime.destroyRuntimeTree(host.id)
    expect(Raph.getDerivedSnapshot().registrations).toBe(0)
    expect(Raph.get(rawPath)).toBeUndefined()
    expect(Raph.get(tablePath)).toBeUndefined()
  })

  it('keeps latest materialized response and ignores a stale transport result', async () => {
    const query = createScheduleQuery('schedule-latest')
    Endge.compiler.buildQuery(query)
    const first = deferred<any[]>()
    const second = deferred<any[]>()
    vi.spyOn(Endge.query, 'executeArtifact')
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
    const host = Endge.runtime.execute(query, {
      id: 'schedule-latest-runtime', persistence: 'disabled', props: { filterPayload: {} },
    }) as QueryRuntimeHost
    const rawPath = host.outputPath('raw')
    const tablePath = host.outputPath('table')

    const firstRun = host.run()
    const secondRun = host.run()
    second.resolve([scheduleRow(2, 'FV', 'new')])
    await secondRun
    first.resolve([scheduleRow(1, 'SU', 'old')])
    await firstRun

    expect((Raph.get(rawPath) as any[])[0].flightNumber).toBe('new')
    expect((Raph.get(tablePath) as any[])[0].flightNumber).toBe('new')
    const node = host.node?.children.find(child => child instanceof RaphDerivedNode) as RaphDerivedNode
    expect(node.snapshot().fullComputeCount).toBe(1)
  })

  it('keeps last-good table and exposes external derived errors on the host', async () => {
    const query = createScheduleQuery('schedule-error')
    Endge.compiler.buildQuery(query)
    vi.spyOn(Endge.query, 'executeArtifact').mockResolvedValue([scheduleRow(1, 'SU', '100')])
    const host = Endge.runtime.execute(query, {
      id: 'schedule-error-runtime', persistence: 'disabled', props: { filterPayload: {} },
    }) as QueryRuntimeHost
    const rawPath = host.outputPath('raw')
    const tablePath = host.outputPath('table')
    await host.run()
    const lastGood = (Raph.get(`${tablePath}[id=1]`) as any).arrivalTime
    const converter = Endge.domain.getConverter('time-string-to-date')!
    converter.setCustom((value) => {
      if (value === 'boom') throw new Error('converter failed')
      return timeStringToDate(value)
    })
    const errors: Error[] = []
    host.on('run:error', error => errors.push(error))

    expect(() => Raph.set(`${rawPath}[id=1].arrivalTime`, 'boom')).toThrow('converter failed')
    await waitForRuntimeTick()
    expect(Raph.get(`${rawPath}[id=1].arrivalTime`)).toBe('boom')
    expect((Raph.get(`${tablePath}[id=1]`) as any).arrivalTime).toBe(lastGood)
    expect(host.context.status).toBe('error')
    expect(errors).toHaveLength(1)

    Raph.set(`${rawPath}[id=1].arrivalTime`, '09:00')
    await waitForRuntimeTick()
    expect(host.context.status).toBe('success')
    expect((Raph.get(`${tablePath}[id=1]`) as any).arrivalTime).toBeInstanceOf(Date)
  })
})


function registerConverter(id: number, identity: string, handler: (value: any) => any): void {
  const converter = new RConverter()
  converter.id = id
  converter.identity = identity
  converter.name = identity
  converter.setCustom(handler)
  Endge.domain.addConverter(converter)
}

function compileScheduleFilter(): void {
  const filter = new RFilter()
  filter.id = 10
  filter.identity = 'schedule'
  filter.name = 'schedule'
  filter.source = `
defineFilter({
  fields: { search: field('String').optional() },
  outputs: {
    request: output().json(({ value }) => compact({ search: value('search') })),
  },
})
`
  Endge.compiler.buildFilter(filter)
}

function createScheduleQuery(identity: string): RQuery {
  const query = new RQuery()
  query.id = 20
  query.identity = identity
  query.name = identity
  query.sourceVersion = 2
  query.source = `
defineQuery({
  kind: 'rest',
  props: defineProps({
    filterPayload: field('Object').optional().from(filter('schedule').output('request')),
  }),
  request: {
    endpoint: env('ENDPOINT_AODB'),
    path: '/select',
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    auth: { mode: 'profile', profile: 'keycloak-dev' },
    body: body(({ prop }) => merge({}, prop('filterPayload'))),
  },
  outputs: {
    raw: output().from(response()),
    table: output()
      .from('raw')
      .dataView(defineDataView({
        mode: 'pipeline',
        steps: [
          from('').as('row'),
          map({
            id: path('row.id'),
            flightCarrier: path('row.flightCarrier'),
            flightNumber: path('row.flightNumber'),
            arrivalTime: path('row.arrivalTime').convert('time-string-to-date'),
            departureTime: path('row.departureTime').convert('time-string-to-date'),
            startDate: path('row.startDate'),
            endDate: path('row.endDate'),
            daysOfWeek: path('row.daysOfWeek').convert('weekdays-range'),
            departureStation: path('row.departureStation'),
            arrivalStation: path('row.arrivalStation'),
            departureTerminal: path('row.departureTerminal'),
            departureGate: path('row.additionalProperties.DepartureGate.text'),
            departurePosition: path('row.additionalProperties.DeparturePosition.text'),
            arrivalTerminal: path('row.arrivalTerminal'),
            arrivalGate: path('row.additionalProperties.ArrivalGate.text'),
            arrivalPosition: path('row.additionalProperties.ArrivalPosition.text'),
            serviceType: path('row.serviceType'),
            aircraftType: path('row.aircraftType'),
            aircraftConfiguration: path('row.aircraftConfiguration'),
          }),
        ],
      })),
  },
  mock: { enabled: false, data: '' },
})
`
  return query
}

function scheduleRow(id: number, carrier: string, number: string) {
  return {
    id,
    flightCarrier: carrier,
    flightNumber: number,
    arrivalTime: '10:15',
    departureTime: '11:30',
    startDate: '2026-07-12',
    endDate: '2026-07-18',
    daysOfWeek: '1-5',
    departureStation: 'SVO',
    arrivalStation: 'LED',
    departureTerminal: 'B',
    arrivalTerminal: 'A',
    additionalProperties: {
      DepartureGate: { text: 'B1' },
      DeparturePosition: { text: '12' },
      ArrivalGate: { text: 'A1' },
      ArrivalPosition: { text: '3' },
    },
    serviceType: 'J',
    aircraftType: 'A320',
    aircraftConfiguration: 'Y180',
  }
}

function waitForRuntimeTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 20))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
