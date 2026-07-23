import { describe, expect, it } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeWorkspace', () => {
  it('normalizes one nested configuration document', () => {
    expect(normalizeEndgeWorkspaceDefinition(TEST_ENDGE_WORKSPACE)).toEqual(TEST_ENDGE_WORKSPACE)
  })

  it('normalizes duplicate and retired adapter identifiers', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      ...TEST_ENDGE_WORKSPACE,
      configuration: {
        ...TEST_ENDGE_WORKSPACE.configuration,
        sfcAdapterIds: [' vue-shadcn ', 'customer:aodb', 'customer:aodb', ''],
        defaultSfcAdapterId: 'customer:aodb',
      },
    })
    expect(workspace.configuration.sfcAdapterIds).toEqual(['native-vue', 'customer:aodb'])
  })

  it('migrates persisted Vue Shadcn adapter ids to Native Vue', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      ...TEST_ENDGE_WORKSPACE,
      configuration: {
        ...TEST_ENDGE_WORKSPACE.configuration,
        sfcAdapterIds: ['native-vue', 'shadcn-vue', 'vue-shadcn'],
        defaultSfcAdapterId: 'shadcn-vue',
      },
    })

    expect(workspace.configuration.sfcAdapterIds).toEqual(['native-vue'])
    expect(workspace.configuration.defaultSfcAdapterId).toBe('native-vue')
  })

  it('rejects flat legacy workspace settings', () => {
    expect(() => normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      locales: [],
    })).toThrow('configuration')
  })
})
