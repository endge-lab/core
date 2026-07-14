import { describe, expect, it } from 'vitest'

import {
  ReflectComponentFromPlain,
  ReflectComponentToPlain,
} from '@/domain/entities/reflect/RComponent'
import { RComponentDSL } from '@/domain/entities/reflect/RComponentDSL'
import { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import { ComponentType } from '@/domain/types/document/document.types'

describe('legacy component documents', () => {
  it('keeps DSL persisted source without compile or execute behavior', () => {
    const component = ReflectComponentFromPlain({
      id: 11,
      identity: 'legacy-dsl',
      name: 'Legacy DSL',
      type: ComponentType.DSL,
      setupScript: 'const value = 1',
      jsxScript: '<Text>{{ value }}</Text>',
      runtimeFilters: ['schedule'],
      inputs: {},
    }) as RComponentDSL

    expect(component).toBeInstanceOf(RComponentDSL)
    expect(component.setupScript).toBe('const value = 1')
    expect(component.jsxScript).toBe('<Text>{{ value }}</Text>')
    expect(component.runtimeFilters).toEqual(['schedule'])
    expect(Object.prototype.hasOwnProperty.call(RComponentDSL.prototype, 'compile')).toBe(false)
    expect((component as any).execute).toBeUndefined()
  })

  it('round-trips the retained Table structure as data only', () => {
    const component = ReflectComponentFromPlain({
      id: 12,
      identity: 'legacy-table',
      name: 'Legacy Table',
      type: ComponentType.Table,
      setupScript: 'const rowHeight = 40',
      sourceIndex: 'rows',
      rowSize: 'zoom',
      runtimeFilters: ['schedule'],
      inputs: {},
      bindings: { keys: { rows: { pk: 'id', fk: 'flightId' } } },
      columns: [{
        id: 'flight',
        isActive: true,
        title: 'Flight',
        type: ComponentType.Html,
        template: '<strong>{{ flight }}</strong>',
        width: 180,
        pin: 'left',
        dataPaths: { flight: '$.flight' },
        dataConverters: {},
        eventHandlers: [],
      }],
    }) as RComponentTable

    const plain = ReflectComponentToPlain(component)

    expect(component).toBeInstanceOf(RComponentTable)
    expect(component.setupScript).toBe('const rowHeight = 40')
    expect(component.columns).toHaveLength(1)
    expect(plain).toMatchObject({
      sourceIndex: 'rows',
      rowSize: 'zoom',
      bindings: { keys: { rows: { pk: 'id', fk: 'flightId' } } },
      columns: [{
        id: 'flight',
        type: ComponentType.Html,
        template: '<strong>{{ flight }}</strong>',
      }],
    })
    expect(Object.prototype.hasOwnProperty.call(RComponentTable.prototype, 'compile')).toBe(false)
    expect((component as any).execute).toBeUndefined()
  })
})
