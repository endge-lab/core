import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RDataView } from '@/features/core/modules/domain/entities/RDataView'
import { EndgeDataView } from '@/features/core/modules/runtime/execution/endge-data-view'
import { DATA_VIEW_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/data-view.default.source'

const dataView = new EndgeDataView()

afterEach(() => {
  vi.restoreAllMocks()
})

const INPUT = {
  legs: [
    {
      id: 'leg1',
      flightCarrier: 'SU',
      flightNumber: '522',
      std: '2025-12-23T13:45:00Z',
      aircraft: {
        type: 'A320',
      },
    },
    {
      id: 'leg2',
      flightCarrier: 'FV',
      flightNumber: '101',
      std: 'invalid-date',
      aircraft: {
        type: 'B738',
      },
    },
  ],
  attrs: [
    {
      legId: 'leg1',
      items: [
        {
          attrId: 'std',
          value: '2025-12-23T13:45:00Z',
        },
        {
          attrId: 'gate',
          value: 'A12',
        },
      ],
    },
    {
      legId: 'leg2',
      items: [
        {
          attrId: 'gate',
          value: 'B03',
        },
      ],
    },
  ],
  statuses: [
    {
      legId: 'leg1',
      value: 'Boarding',
    },
    {
      legId: 'leg2',
      value: 'Delayed',
    },
  ],
}

describe('преобразование pipeline EndgeDataView', () => {
  it('передаёт результат каждого select следующему шагу и возвращает последний результат', () => {
    const output = dataView.runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    select({
      rows: path('items').where(match({ active: true })),
    }),
    select(path('rows').map(pick(['id', 'name']))),
  ],
})
`, {
      items: [
        { id: 1, name: 'First', active: true },
        { id: 2, name: 'Second', active: false },
      ],
    })

    expect(output).toEqual([
      { id: 1, name: 'First' },
    ])
  })

  it('возвращает результат корневого выражения без оболочки объектной проекции', () => {
    const output = dataView.runSource(`
defineDataView({
  output: fullJoin(
    path('pairsArrival'),
    path('pairsDeparture'),
  )
    .byAny('arrivalLeg.id', 'departureLeg.id')
    .coalesce(),
})
`, {
      pairsArrival: [{ id: 'A-null', arrivalLeg: { id: 'A' } }],
      pairsDeparture: [{ id: 'A-D', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } }],
    })

    expect(output).toEqual([
      { id: 'A-null', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } },
    ])
  })

  it('вычисляет output проекции для всего входного объекта', () => {
    const output = dataView.runSource(`
defineDataView({
  output: {
    pairs: fullJoin(
      path('pairsArrival'),
      path('pairsDeparture'),
    )
      .byAny('arrivalLeg.id', 'departureLeg.id')
      .coalesce()
      .enrich('arrivalLeg', {
        attributes: lookupOne(path('attributes')).by('legId').getOr('items', []),
      })
      .enrich('departureLeg', {
        activities: lookupMany(path('activities')).by('legId'),
      }),
  },
})
`, {
      pairsArrival: [{ id: 'A-null', arrivalLeg: { id: 'A' } }],
      pairsDeparture: [{ id: 'A-D', arrivalLeg: { id: 'A' }, departureLeg: { id: 'D' } }],
      attributes: [{ legId: 'A', items: [{ name: 'BestOn' }] }],
      activities: [{ legId: 'D', code: 'pushback' }],
    })

    expect(output).toEqual({
      pairs: [{
        id: 'A-null',
        arrivalLeg: { id: 'A', attributes: [{ name: 'BestOn' }] },
        departureLeg: { id: 'D', activities: [{ legId: 'D', code: 'pushback' }] },
      }],
    })
  })

  it('выполняет стандартный Source как legs, дополненные связанными attrs', () => {
    const output = dataView.runSource(DATA_VIEW_DEFAULT_SOURCE, {
      legs: [
        {
          id: 'leg1',
          flightCarrier: 'SU',
          flightNumber: '522',
        },
      ],
      attrs: [
        {
          legId: 'leg1',
          items: [
            {
              attrId: 'std',
              value: '2025-12-23T00:00:00Z',
            },
          ],
        },
      ],
    })

    expect(output).toEqual([
      {
        id: 'leg1',
        flightCarrier: 'SU',
        flightNumber: '522',
        attrs: [
          {
            attrId: 'std',
            value: '2025-12-23T00:00:00Z',
          },
        ],
      },
    ])
  })

  it('выполняет from, join, map, path, template, find, pick и convert', () => {
    const output = dataView.runSource(createFlightPipelineSource('std'), INPUT)

    expect(output).toEqual([
      {
        id: 'leg1',
        flightCarrier: 'SU',
        flightNumber: '522',
        aircraftType: 'A320',
        flight: 'SU/522',
        status: 'Boarding',
        attrValue: '2025-12-23T13:45:00Z',
        attrTime: '13:45',
      },
      {
        id: 'leg2',
        flightCarrier: 'FV',
        flightNumber: '101',
        aircraftType: 'B738',
        flight: 'FV/101',
        status: 'Delayed',
        attrValue: undefined,
        attrTime: undefined,
      },
    ])
  })

  it('безопасно обрабатывает отсутствующую цепочку find/pick, а JSON preview пропускает неопределённые поля', () => {
    const output = dataView.runSource(createFlightPipelineSource('attr1'), INPUT)

    expect(output).toEqual([
      expect.objectContaining({
        id: 'leg1',
        flight: 'SU/522',
        attrValue: undefined,
        attrTime: undefined,
      }),
      expect.objectContaining({
        id: 'leg2',
        flight: 'FV/101',
        attrValue: undefined,
        attrTime: undefined,
      }),
    ])
    expect(JSON.stringify(output, null, 2)).not.toContain('attrValue')
    expect(JSON.stringify(output, null, 2)).not.toContain('attrTime')
  })

  it('поддерживает литеральные поля map', () => {
    const output = dataView.runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('legs').as('leg'),
    map({
      stringValue: 'fixed',
      numberValue: 12,
      booleanValue: true,
      nullValue: null,
    }),
  ],
})
`, INPUT)

    expect(output).toEqual([
      { stringValue: 'fixed', numberValue: 12, booleanValue: true, nullValue: null },
      { stringValue: 'fixed', numberValue: 12, booleanValue: true, nullValue: null },
    ])
  })

  it('поддерживает spread в map и явное переопределение поля', () => {
    const output = dataView.runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('legs').as('leg'),
    map({
      ...spread('leg'),
      id: template('override:{leg.id}'),
      flight: template('{leg.flightCarrier}/{leg.flightNumber}'),
    }),
  ],
})
`, INPUT)

    expect(output).toEqual([
      {
        id: 'override:leg1',
        flightCarrier: 'SU',
        flightNumber: '522',
        std: '2025-12-23T13:45:00Z',
        aircraft: { type: 'A320' },
        flight: 'SU/522',
      },
      {
        id: 'override:leg2',
        flightCarrier: 'FV',
        flightNumber: '101',
        std: 'invalid-date',
        aircraft: { type: 'B738' },
        flight: 'FV/101',
      },
    ])
  })

  it('возвращает пустые строки, если Source для from отсутствует или не является массивом', () => {
    const output = dataView.runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('missing').as('row'),
    map({
      id: path('row.id'),
    }),
  ],
})
`, INPUT)

    expect(output).toEqual([])
  })

  it('возвращает исходные строки, если pipeline содержит from без map', () => {
    const output = dataView.runSource(`
defineDataView({
  mode: 'pipeline',
  steps: [
    from('legs').as('leg'),
  ],
})
`, INPUT)

    expect(output).toEqual(INPUT.legs)
  })
})

describe('ручное преобразование EndgeDataView', () => {
  it('отклоняет manual source до появления безопасного runtime', () => {
    expect(() => dataView.runSource(`
defineDataView({
  mode: 'manual',

  transform(input, tools) {
    return input.legs.map((leg) => {
      const attrs = input.attrs.find((item) => item.legId === leg.id)
      const std = tools.pick(
        attrs.items.find((item) => item.attrId === 'std'),
        'value',
      )

      return {
        id: tools.path(leg, 'id'),
        flight: tools.template('{flightCarrier}/{flightNumber}', leg),
        stdTime: tools.convert('date.iso_to_time', std, { format: 'HH:mm' }),
      }
    })
  },
})
`, INPUT)).toThrow('mode "manual" временно отключён')
  })

  it('не исполняет tool overrides для отключённого manual source', () => {
    const convert = vi.fn((_identity: string, value: unknown) => String(value).toLowerCase())
    expect(() => dataView.runSource(`
defineDataView({
  mode: 'manual',

  transform(input, tools) {
    return input.legs.map((leg) => ({
      id: tools.path(leg, 'id'),
      flight: tools.template('{flightCarrier}/{flightNumber}', leg),
      converted: tools.convert('custom.upper', leg.flightCarrier),
    }))
  },
})
`, INPUT, {
      convert,
    })).toThrow('mode "manual" временно отключён')

    expect(convert).not.toHaveBeenCalled()
  })
})

describe('владение артефактом EndgeDataView', () => {
  /** Проверяет запрет локальной компиляции persisted DataView во время runtime. */
  it('отклоняет выполнение без artifact общего build pipeline', () => {
    const model = new RDataView()
    model.id = 501
    model.identity = 'schedule-view'
    const resolveArtifact = vi.spyOn(Endge.program, 'getDataViewArtifact').mockReturnValue(null)
    const compile = vi.spyOn(Endge.compiler, 'buildDataView')

    expect(() => dataView.run(model, [])).toThrow('Run the compiler build before runtime execution')
    expect(resolveArtifact).toHaveBeenCalledWith(501)
    expect(compile).not.toHaveBeenCalled()
  })
})

function createFlightPipelineSource(attrId: string): string {
  return `
defineDataView({
  mode: 'pipeline',

  steps: [
    from('legs').as('leg'),

    join('attrs').by({
      left: 'leg.id',
      right: 'legId',
      as: 'legAttrs',
    }),

    join('statuses').by({
      left: 'leg.id',
      right: 'legId',
      as: 'status',
    }),

    map({
      id: path('leg.id'),
      flightCarrier: path('leg.flightCarrier'),
      flightNumber: path('leg.flightNumber'),
      aircraftType: path('leg.aircraft.type'),
      flight: template('{leg.flightCarrier}/{leg.flightNumber}'),
      status: path('status.value'),

      attrValue: path('legAttrs.items')
        .find({ attrId: '${attrId}' })
        .pick('value'),

      attrTime: path('legAttrs.items')
        .find({ attrId: '${attrId}' })
        .pick('value')
        .convert('date.iso_to_time', { format: 'HH:mm' }),
    }),
  ],
})
`
}
