import { describe, expect, it } from 'vitest'

import {
  ReflectComponentFromPlain,
  ReflectComponentToPlain,
} from '@/modules/domain/entities/RComponent'
import { RComponentDSL } from '@/modules/domain/entities/RComponentDSL'
import { RComponentTable } from '@/modules/domain/entities/RComponentTable'
import { ComponentType } from '@/modules/domain/types/document/document.types'

describe('проверка Legacy-документы компонентов', () => {
  it('сохраняет записанный Source DSL без поведения компиляции или выполнения', () => {
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
    expect(Object.hasOwn(RComponentDSL.prototype, 'compile')).toBe(false)
    expect((component as any).execute).toBeUndefined()
  })

  it('сохраняет оставленную структуру Table при двустороннем преобразовании только как данные', () => {
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
    expect(Object.hasOwn(RComponentTable.prototype, 'compile')).toBe(false)
    expect((component as any).execute).toBeUndefined()
  })
})
