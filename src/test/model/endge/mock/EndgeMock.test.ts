import { describe, expect, it } from 'vitest'

import { EndgeMock } from '@/model/endge/mock/EndgeMock'

describe('EndgeMock', () => {
  it('registers JSON data and returns an independent copy', () => {
    const registry = new EndgeMock()
    registry.register({
      identity: 'test.rows',
      data: { rows: [{ id: 1 }] },
    })

    const first = registry.get<{ rows: Array<{ id: number }> }>('test.rows')
    first.rows[0]!.id = 2

    expect(registry.get('test.rows')).toEqual({ rows: [{ id: 1 }] })
  })

  it('restores built-in Ground Handling mock on reset', () => {
    const registry = new EndgeMock()

    expect(registry.has('groundhandling')).toBe(true)
    expect(registry.get<any>('groundhandling').pairsArrival).toHaveLength(2)

    registry.reset()
    expect(registry.list()).toEqual([
      {
        identity: 'groundhandling',
        description: 'Ground Handling preview data',
      },
    ])
  })
})
