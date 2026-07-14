import { describe, expect, it } from 'vitest'

import { DATA_VIEW_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/data-view.default.source'
import { EndgeDataView } from '@/model/endge/endge-data-view'

const dataView = new EndgeDataView()

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

describe('EndgeDataView pipeline transform', () => {
  it('runs default source as legs enriched with related attrs', () => {
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

  it('runs from, join, map, path, template, find, pick and convert', () => {
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

  it('keeps missing find/pick chain safe and JSON preview omits undefined fields', () => {
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

  it('supports literal map fields', () => {
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

  it('supports map spread and explicit field override', () => {
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

  it('returns empty rows when from source is missing or not an array', () => {
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

  it('returns original rows when pipeline has from without map', () => {
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

describe('EndgeDataView manual transform', () => {
  it('runs transform source with input and built-in tools', () => {
    const output = dataView.runSource(`
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
`, INPUT)

    expect(output).toEqual([
      {
        id: 'leg1',
        flight: 'SU/522',
        stdTime: '13:45',
      },
      {
        id: 'leg2',
        flight: 'FV/101',
        stdTime: undefined,
      },
    ])
  })

  it('allows runtime tool overrides for preview and tests', () => {
    const output = dataView.runSource(`
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
      convert: (_identity, value) => String(value).toLowerCase(),
    })

    expect(output).toEqual([
      { id: 'leg1', flight: 'SU/522', converted: 'su' },
      { id: 'leg2', flight: 'FV/101', converted: 'fv' },
    ])
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
