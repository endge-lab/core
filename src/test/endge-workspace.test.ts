import { describe, expect, it } from 'vitest'

import { normalizeEndgeWorkspaceDefinition } from '@/domain/entities/reflect/RWorkspace'
import { Endge } from '@/model/endge/kernel/endge'

describe('EndgeWorkspace', () => {
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
      themes: [
        { identity: 'light', displayName: 'Light' },
        { identity: 'dark', displayName: 'Dark' },
      ],
      defaultTheme: 'light',
      sfcAdapterIds: ['native-vue'],
      defaultSfcAdapterId: 'native-vue',
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
      themes: [
        { identity: 'light', displayName: 'Light' },
        { identity: 'dark', displayName: 'Dark' },
      ],
      defaultTheme: 'light',
      defaultAuthProfileIdentity: null,
      sfcAdapterIds: ['native-vue'],
      defaultSfcAdapterId: 'native-vue',
    })
  })

  it('normalizes workspace SFC adapter identifiers', () => {
    const workspace = normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      locales: [{ code: 'en', displayName: 'English', shortLabel: 'EN' }],
      defaultLocale: 'en',
      fallbackLocale: 'en',
      themes: [{ identity: 'light', displayName: 'Light' }],
      defaultTheme: 'light',
      sfcAdapterIds: [' shadcn-vue ', 'customer:aodb', 'customer:aodb', ''],
      defaultSfcAdapterId: 'customer:aodb',
    })

    expect(workspace.sfcAdapterIds).toEqual(['shadcn-vue', 'customer:aodb'])
    expect(workspace.defaultSfcAdapterId).toBe('customer:aodb')
  })

  it('rejects an unavailable selected SFC adapter', () => {
    expect(() => normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      locales: [{ code: 'en', displayName: 'English', shortLabel: 'EN' }],
      defaultLocale: 'en',
      fallbackLocale: 'en',
      themes: [{ identity: 'light', displayName: 'Light' }],
      defaultTheme: 'light',
      sfcAdapterIds: ['customer:aodb'],
      defaultSfcAdapterId: 'missing',
    })).toThrow('defaultSfcAdapterId')
  })

  it('supports object locale map through the workspace module', () => {
    const definition = normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      locales: {
        en: { nativeLabel: 'English' },
        kk: { label: 'Kazakh', nativeLabel: 'Қазақша' },
      },
      defaultLocale: 'kk',
      fallbackLocale: 'en',
      themes: {
        light: { displayName: 'Light' },
        dark: { displayName: 'Dark' },
      },
      defaultTheme: 'dark',
      sfcAdapterIds: ['native-vue'],
      defaultSfcAdapterId: 'native-vue',
    })
    const workspace = Endge.workspace

    workspace.apply(definition)

    expect(workspace.supportsLocale('kk')).toBe(true)
    expect(workspace.normalizeLocale('missing')).toBe('kk')
    expect(workspace.getLocaleLabel('kk', 'displayName')).toBe('Қазақша')
    expect(workspace.themes.map(theme => theme.identity)).toEqual(['light', 'dark'])
    expect(workspace.normalizeTheme('missing')).toBe('dark')
  })

  it('rejects a default theme outside the workspace catalog', () => {
    expect(() => normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
      locales: [{ code: 'en', displayName: 'English', shortLabel: 'EN' }],
      defaultLocale: 'en',
      fallbackLocale: 'en',
      themes: [{ identity: 'light', displayName: 'Light' }],
      defaultTheme: 'dark',
      sfcAdapterIds: ['native-vue'],
      defaultSfcAdapterId: 'native-vue',
    })).toThrow('defaultTheme')
  })

  it('rejects incomplete Payload workspace data', () => {
    expect(() => normalizeEndgeWorkspaceDefinition({
      identity: 'workspace-a',
      displayName: 'Workspace A',
    })).toThrow('locales')
  })
})
