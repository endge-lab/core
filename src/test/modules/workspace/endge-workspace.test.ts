import { describe, expect, it } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/modules/domain/entities/RWorkspace'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('рабочее пространство Endge', () => {
  it('нормализует один вложенный документ Configuration', () => {
    expect(normalizeEndgeWorkspaceDefinition(TEST_ENDGE_WORKSPACE)).toEqual(TEST_ENDGE_WORKSPACE)
  })

  it('нормализует повторяющиеся и legacy-идентификаторы адаптеров', () => {
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

  it('мигрирует сохранённые ID адаптера Vue Shadcn в канонический ID адаптера', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      ...TEST_ENDGE_WORKSPACE,
      configuration: {
        ...TEST_ENDGE_WORKSPACE.configuration,
        sfcAdapterIds: ['native-vue', 'vue-native', 'shadcn-vue', 'vue-shadcn'],
        defaultSfcAdapterId: 'shadcn-vue',
      },
    })

    expect(workspace.configuration.sfcAdapterIds).toEqual(['vue-native', 'vue-shadcn'])
    expect(workspace.configuration.defaultSfcAdapterId).toBe('vue-shadcn')
  })

  it('отклоняет плоские legacy-настройки Workspace', () => {
    expect(() => normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      locales: [],
    })).toThrow('configuration')
  })
})
