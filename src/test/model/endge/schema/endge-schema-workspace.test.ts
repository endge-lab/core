import { describe, expect, it } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { normalizePayloadWorkspace } from '@/model/endge/schema/endge-schema-database'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('Payload workspace schema mapping', () => {
  it('preserves nested configuration before workspace build', () => {
    const mapped = normalizePayloadWorkspace({ id: 1, ...TEST_ENDGE_WORKSPACE })
    const workspace = normalizeEndgeWorkspaceDefinition(mapped)
    expect(mapped.configuration).toEqual(TEST_ENDGE_WORKSPACE.configuration)
    expect(workspace.configuration.defaultTheme).toBe('light')
  })
})
