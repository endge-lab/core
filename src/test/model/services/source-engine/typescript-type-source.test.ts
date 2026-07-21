import { describe, expect, it } from 'vitest'

import { compileComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-compile'
import { analyzeTypeScriptTypeDeclarations } from '@/model/services/source-engine/typescript-type-source'

describe('typescript type source extraction', () => {
  it('converts a safe interface into canonical Type Source data', () => {
    const [result] = analyzeTypeScriptTypeDeclarations(`interface FlightRow {
  /** Stable flight identity. */
  id: string
  delayed?: boolean
  tags: string[]
  status: 'scheduled' | 'departed'
}`)

    expect(result).toMatchObject({
      identity: 'FlightRow',
      kind: 'interface',
      unsupportedReason: null,
      dependencies: [],
      document: {
        definition: {
          kind: 'object',
          fields: [
            {
              key: 'id',
              type: { kind: 'reference', identity: 'String' },
              description: 'Stable flight identity.',
              optional: false,
              array: false,
            },
            {
              key: 'delayed',
              type: { kind: 'reference', identity: 'Boolean' },
              optional: true,
              array: false,
            },
            {
              key: 'tags',
              type: { kind: 'reference', identity: 'String' },
              optional: false,
              array: true,
            },
            {
              key: 'status',
              type: { kind: 'enum', values: ['scheduled', 'departed'] },
              optional: false,
              array: false,
            },
          ],
        },
      },
    })
  })

  it('keeps local references so the editor can extract their dependency closure', () => {
    const results = analyzeTypeScriptTypeDeclarations(`interface Address { city: string }
interface Passenger { address: Address }`)

    expect(results[0]?.unsupportedReason).toBeNull()
    expect(results[1]).toMatchObject({
      identity: 'Passenger',
      dependencies: ['Address'],
      unsupportedReason: null,
      document: {
        definition: {
          fields: [{ type: { kind: 'reference', identity: 'Address' } }],
        },
      },
    })
  })

  it('resolves an extracted RType as an external named props contract', () => {
    const definition = analyzeTypeScriptTypeDeclarations(`interface FlightRow {
  id: string
  delayed?: boolean
  tags: string[]
}`)[0]?.document?.definition ?? null
    const result = compileComponentSFC(`<script setup lang="ts">
defineProps<FlightRow>()
</script>
<template><Text>Flight</Text></template>`, {
      resolveTypeDefinition: identity => identity === 'FlightRow' ? definition : null,
    })

    expect(result.contract.inputs).toEqual([
      { name: 'id', type: 'String', isArray: false, optional: false },
      { name: 'delayed', type: 'Boolean', isArray: false, optional: true },
      { name: 'tags', type: 'Array<String>', isArray: true, optional: false },
    ])
  })
})
