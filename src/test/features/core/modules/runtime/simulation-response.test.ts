import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { TypeProgramPayload, TypeSourceField } from '@/features/core/modules/source/domain/types/type-source.types'

import { describe, expect, it } from 'vitest'
import { generateSimulationResponse } from '@/features/core/modules/runtime/services/simulation/generate-simulation-response'

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
    field('name', 'String'),
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

describe('simulation response generation', () => {
  it('uses compiled nested array paths, seed, and fractional bounds', () => {
    const contract = { key: 'result', type: 'Envelope', array: false, optional: false }
    const request = { kind: 'mock-request' as const, seed: 'fixed', arrays: { 'items': 20, 'items[].children': 2 } }
    const first = generateSimulationResponse(contract, request, reader, 'a') as { items: { price: number, children: string[] }[] }
    expect(first).toEqual(generateSimulationResponse(contract, request, reader, 'b'))
    expect(first.items).toHaveLength(20)
    for (const row of first.items) {
      expect(row.children).toHaveLength(2)
      expect(row.price).toBeGreaterThanOrEqual(0.1)
      expect(row.price).toBeLessThanOrEqual(0.2)
    }
  })

  it('rejects required recursion before executing a target', () => {
    expect(() => generateSimulationResponse(
      { key: 'result', type: 'Recursive', array: false, optional: false },
      { kind: 'mock-request', arrays: {} },
      reader,
      'a',
    )).toThrow('рекурсивную')
  })

  it('limits multiplied nested arrays even when each size is individually valid', () => {
    expect(() => generateSimulationResponse(
      { key: 'result', type: 'Envelope', array: false, optional: false },
      { kind: 'mock-request', arrays: { 'items': 1000, 'items[].children': 1000 } },
      reader,
      'a',
    )).toThrow()
  })
})
