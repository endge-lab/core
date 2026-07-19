import { describe, expect, it } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeWorkspace', () => {
  it('normalizes one nested configuration document', () => {
    expect(normalizeEndgeWorkspaceDefinition(TEST_ENDGE_WORKSPACE)).toEqual(TEST_ENDGE_WORKSPACE)
  })

  it('normalizes duplicate adapter identifiers', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      ...TEST_ENDGE_WORKSPACE,
      configuration: {
        ...TEST_ENDGE_WORKSPACE.configuration,
        sfcAdapterIds: [' vue-shadcn ', 'customer:aodb', 'customer:aodb', ''],
        defaultSfcAdapterId: 'customer:aodb',
      },
    })
    expect(workspace.configuration.sfcAdapterIds).toEqual(['vue-shadcn', 'customer:aodb'])
  })

  it('migrates the persisted legacy Vue Shadcn adapter id', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      ...TEST_ENDGE_WORKSPACE,
      configuration: {
        ...TEST_ENDGE_WORKSPACE.configuration,
        sfcAdapterIds: ['native-vue', 'shadcn-vue', 'vue-shadcn'],
        defaultSfcAdapterId: 'shadcn-vue',
      },
    })

    expect(workspace.configuration.sfcAdapterIds).toEqual(['native-vue', 'vue-shadcn'])
    expect(workspace.configuration.defaultSfcAdapterId).toBe('vue-shadcn')
  })

  it('rejects flat legacy workspace settings', () => {
    expect(() => normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      locales: [],
    })).toThrow('configuration')
  })
})
