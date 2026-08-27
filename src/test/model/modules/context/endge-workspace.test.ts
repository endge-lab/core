import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/model/kernel/endge'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('endgeWorkspace', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the applied workspace', () => {
    const workspace = Endge.workspace
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.locales.map(locale => locale.code)).toEqual(['en', 'ru'])
    expect(workspace.defaultLocale).toBe('ru')
    expect(workspace.fallbackLocale).toBe('ru')
    expect(workspace.themes.map(theme => theme.identity)).toEqual(['light', 'dark'])
    expect(workspace.defaultTheme).toBe('light')
    expect(workspace.sfcAdapterIds).toEqual(['vue-native'])
    expect(workspace.defaultSfcAdapterId).toBe('vue-native')
    expect(workspace.dataMode).toBe('live')
    expect(Endge.context.dataMode).toBe('live')
  })

  it('applies the persisted mock default to EndgeContext', () => {
    Endge.context.clearDataModeOverride()

    Endge.workspace.apply({ ...TEST_ENDGE_WORKSPACE, dataMode: 'mock' })

    expect(Endge.workspace.isMockEnabled).toBe(true)
    expect(Endge.context.isMockEnabled).toBe(true)
  })

  it('normalizes unsupported locales to default locale', () => {
    const workspace = Endge.workspace
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.normalizeLocale('ru')).toBe('ru')
    expect(workspace.normalizeLocale('en')).toBe('en')
    expect(workspace.normalizeLocale('kk')).toBe('ru')
    expect(workspace.normalizeLocale(null)).toBe('ru')
  })

  it('returns locale labels by mode', () => {
    const workspace = Endge.workspace
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.getLocaleLabel('ru', 'displayName')).toBe('Русский')
    expect(workspace.getLocaleLabel('en', 'shortLabel')).toBe('EN')
    expect(workspace.getLocaleLabel('kk', 'shortLabel')).toBe('kk')
  })

  it('normalizes themes and returns their labels', () => {
    const workspace = Endge.workspace
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.supportsTheme('dark')).toBe(true)
    expect(workspace.normalizeTheme('missing')).toBe('light')
    expect(workspace.getThemeLabel('dark')).toBe('Тёмная')
  })

  it('fails before a workspace is applied', () => {
    const workspace = Endge.workspace
    workspace.reset()

    expect(() => workspace.current).toThrow('Workspace has not been loaded')
  })
})
