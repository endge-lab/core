import { afterEach, describe, expect, it } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import {
  DEFAULT_ENDGE_WORKSPACE,
  getWorkspaceLocaleLabel,
  normalizeWorkspaceLocale,
  setActiveEndgeWorkspace,
  supportsWorkspaceLocale,
} from '@/model/config/endge-workspace'

describe('EndgeWorkspace', () => {
  afterEach(() => {
    setActiveEndgeWorkspace(DEFAULT_ENDGE_WORKSPACE)
  })

  it('normalizes payload workspace locales', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      vars: [],
      sse: undefined,
      locales: [
        { code: 'en', displayName: 'English', shortLabel: 'EN' },
        { code: 'kk', displayName: 'Қазақша', shortLabel: 'KK' },
      ],
      defaultLocale: 'kk',
      fallbackLocale: 'en',
    })

    expect(workspace).toEqual({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      vars: [],
      sse: undefined,
      locales: [
        { code: 'en', displayName: 'English', shortLabel: 'EN' },
        { code: 'kk', displayName: 'Қазақша', shortLabel: 'KK' },
      ],
      defaultLocale: 'kk',
      fallbackLocale: 'en',
      defaultAuthProfileIdentity: null,
      sfcAdapterIds: ['shadcn-vue'],
      defaultSfcAdapterId: 'shadcn-vue',
    })
  })

  it('normalizes workspace SFC adapter identifiers', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      sfcAdapterIds: [' shadcn-vue ', 'customer:aodb', 'customer:aodb', ''],
      defaultSfcAdapterId: 'customer:aodb',
    })

    expect(workspace.sfcAdapterIds).toEqual(['shadcn-vue', 'customer:aodb'])
    expect(workspace.defaultSfcAdapterId).toBe('customer:aodb')
  })

  it('uses the first available SFC adapter when the selected identifier is unavailable', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      sfcAdapterIds: ['customer:aodb'],
      defaultSfcAdapterId: 'missing',
    })

    expect(workspace.sfcAdapterIds).toEqual(['customer:aodb'])
    expect(workspace.defaultSfcAdapterId).toBe('customer:aodb')
  })

  it('supports object locale map and updates shared locale helpers', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      locales: {
        en: { nativeLabel: 'English' },
        kk: { label: 'Kazakh', nativeLabel: 'Қазақша' },
      },
      defaultLocale: 'kk',
    })

    setActiveEndgeWorkspace(workspace)

    expect(supportsWorkspaceLocale('kk')).toBe(true)
    expect(normalizeWorkspaceLocale('missing')).toBe('kk')
    expect(getWorkspaceLocaleLabel('kk', 'displayName')).toBe('Қазақша')
  })
})
