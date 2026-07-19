import { describe, expect, it, vi } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { Endge } from '@/model/endge/kernel/endge'
import {
  EndgeSchemaStorage,
  normalizePayloadWorkspace,
  normalizeSavedPayloadWorkspace,
} from '@/model/endge/schema/endge-schema-database'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('Payload workspace schema mapping', () => {
  it('preserves nested configuration before workspace build', () => {
    const mapped = normalizePayloadWorkspace({ id: 1, ...TEST_ENDGE_WORKSPACE })
    const workspace = normalizeEndgeWorkspaceDefinition(mapped)
    expect(mapped.configuration).toEqual(TEST_ENDGE_WORKSPACE.configuration)
    expect(workspace.configuration.defaultTheme).toBe('light')
  })

  it('restores required fields when PATCH returns a partial workspace', () => {
    const saved = normalizeSavedPayloadWorkspace(
      { configuration: TEST_ENDGE_WORKSPACE.configuration },
      TEST_ENDGE_WORKSPACE,
    )

    expect(saved.identity).toBe(TEST_ENDGE_WORKSPACE.identity)
    expect(saved.displayName).toBe(TEST_ENDGE_WORKSPACE.displayName)
    expect(saved.configuration).toEqual(TEST_ENDGE_WORKSPACE.configuration)
  })

  it('unwraps a workspace returned inside the Payload doc envelope', () => {
    const saved = normalizeSavedPayloadWorkspace(
      {
        doc: {
          identity: 'saved-workspace',
          displayName: 'Saved workspace',
          configuration: TEST_ENDGE_WORKSPACE.configuration,
        },
      },
      TEST_ENDGE_WORKSPACE,
    )

    expect(saved.identity).toBe('saved-workspace')
    expect(saved.displayName).toBe('Saved workspace')
  })

  it('does not hide an invalid identity returned explicitly by Payload', () => {
    expect(() => normalizeSavedPayloadWorkspace(
      { identity: '' },
      TEST_ENDGE_WORKSPACE,
    )).toThrow('[RWorkspace] Payload field "identity" is required')
  })

  it('temporarily clears installed integrations when saving a workspace', async () => {
    const workspace = {
      ...TEST_ENDGE_WORKSPACE,
      installedIntegrations: [{
        integrationId: 7,
        integrationIdentity: 'example-integration',
        version: '1.0.0',
      }],
    }
    const upsert = vi.fn(async (payload: Record<string, unknown>) => payload)
    const storage = new EndgeSchemaStorage()

    storage.repositories = { workspaces: { upsert } } as any
    vi.spyOn(Endge.workspace, 'apply').mockImplementation(() => undefined)

    await storage.saveDocument(workspace.identity, 'workspace', { model: workspace })

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      installedIntegrations: [],
    }))
  })
})
