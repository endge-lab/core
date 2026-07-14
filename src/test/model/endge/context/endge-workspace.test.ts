import { describe, expect, it } from 'vitest'

import { EndgeWorkspace } from '@/model/endge/context/endge-workspace'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeWorkspace', () => {
  it('exposes the applied Payload workspace', () => {
    const workspace = new EndgeWorkspace()
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.locales.map(locale => locale.code)).toEqual(['en', 'ru'])
    expect(workspace.defaultLocale).toBe('ru')
    expect(workspace.fallbackLocale).toBe('ru')
    expect(workspace.sfcAdapterIds).toEqual(['native-vue', 'shadcn-vue'])
    expect(workspace.defaultSfcAdapterId).toBe('shadcn-vue')
  })

  it('normalizes unsupported locales to default locale', () => {
    const workspace = new EndgeWorkspace()
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.normalizeLocale('ru')).toBe('ru')
    expect(workspace.normalizeLocale('en')).toBe('en')
    expect(workspace.normalizeLocale('kk')).toBe('ru')
    expect(workspace.normalizeLocale(null)).toBe('ru')
  })

  it('returns locale labels by mode', () => {
    const workspace = new EndgeWorkspace()
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.getLocaleLabel('ru', 'displayName')).toBe('Русский')
    expect(workspace.getLocaleLabel('en', 'shortLabel')).toBe('EN')
    expect(workspace.getLocaleLabel('kk', 'shortLabel')).toBe('kk')
  })

  it('fails before a Payload workspace is applied', () => {
    const workspace = new EndgeWorkspace()

    expect(() => workspace.current).toThrow('Workspace has not been loaded from Payload')
  })
})
