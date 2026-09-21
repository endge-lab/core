import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { TypeProgramPayload, TypeSourceField } from '@/features/core/modules/source/domain/types/type-source.types'

import { describe, expect, it } from 'vitest'
import { createSimulationSchema } from '@/features/core/modules/runtime/services/simulation/create-simulation-schema'

function field(key: string, identity: string, extra: Partial<TypeSourceField> = {}): TypeSourceField {
  return {
    key,
    type: { kind: 'reference', identity },
    optional: false,
    array: false,
    examples: [],
    ...extra,
  }
}
const artifacts: Record<string, TypeProgramPayload> = {
  String: { type: 'type', sourceVersion: 1, definition: null, runtimeType: 'String' },
  Number: { type: 'type', sourceVersion: 1, definition: null, runtimeType: 'Number' },
  Row: { type: 'type', sourceVersion: 1, definition: { kind: 'object', fields: [
    field('name', 'String', { examples: ['example-name'] }),
    field('price', 'Number', { min: 0.1, max: 0.2 }),
    field('children', 'String', { array: true }),
  ] } },
  Envelope: { type: 'type', sourceVersion: 1, definition: { kind: 'object', fields: [field('items', 'Row', { array: true })] } },
  Recursive: { type: 'type', sourceVersion: 1, definition: { kind: 'object', fields: [field('child', 'Recursive')] } },
}
const reader: RuntimeArtifactReader = {
  getArtifact: <T>(_kind: unknown, identity: string | number) => artifacts[String(identity)]
    ? { status: 'valid', payload: artifacts[String(identity)] } as ProgramArtifact<T>
    : null,
}

describe('simulation schema projection', () => {
  /** Отключение примеров не ослабляет типы и размеры вложенных массивов. */
  it('исключает примеры по запросу сценария, сохраняя исходные артефакты и ограничения', () => {
    const contract = { type: 'Envelope', array: false }
    const normal = createSimulationSchema(contract, reader, { items: 50 })
    expect(JSON.stringify(normal)).toContain('example-name')
    const generated = createSimulationSchema(contract, reader, { items: 50 }, {}, false)
    expect(JSON.stringify(generated)).not.toContain('examples')
    expect(generated).toMatchObject({ properties: { items: { minItems: 50, maxItems: 50, items: { properties: {
      name: { type: 'string' },
      price: { type: 'number', minimum: 0.1, maximum: 0.2 },
    } } } } })
    expect(createSimulationSchema(contract, reader, { items: 50 })).toEqual(normal)
  })

  it('preserves nested array counts and fractional field constraints for the service', () => {
    const schema = createSimulationSchema({ type: 'Envelope', array: false }, reader, { 'items': 20, 'items[].children': 2 })
    expect(schema).toMatchObject({ type: 'object', properties: { items: { minItems: 20, maxItems: 20, items: { properties: {
      price: { type: 'number', minimum: 0.1, maximum: 0.2 },
      children: { type: 'array', minItems: 2, maxItems: 2 },
    } } } } })
  })

  it('rejects recursive types and unknown scenario fields', () => {
    expect(() => createSimulationSchema({ type: 'Recursive', array: false }, reader)).toThrow('Рекурсивный')
    expect(() => createSimulationSchema({ type: 'Row', array: false }, reader, {}, { missing: { enum: ['x'] } })).toThrow('отсутствует')
  })

  it('narrows constraints and rejects widening enum types and empty ranges', () => {
    expect(createSimulationSchema({ type: 'Row', array: false }, reader, {}, { price: { minimum: 0.15 } })).toMatchObject({ properties: { price: { minimum: 0.15, maximum: 0.2 } } })
    expect(() => createSimulationSchema({ type: 'Row', array: false }, reader, {}, { price: { minimum: 1 } })).toThrow('Пустой диапазон')
    expect(() => createSimulationSchema({ type: 'Row', array: false }, reader, {}, { name: { enum: [1] } })).toThrow('несовместим')
  })
})
