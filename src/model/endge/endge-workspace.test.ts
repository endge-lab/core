import { describe, expect, it } from 'vitest'

import { EndgeWorkspace } from '@/model/endge/endge-workspace'

describe('EndgeWorkspace', () => {
  it('exposes default workspace locales', () => {
    const workspace = new EndgeWorkspace()

    expect(workspace.locales.map(locale => locale.code)).toEqual(['en', 'ru'])
    expect(workspace.defaultLocale).toBe('ru')
    expect(workspace.fallbackLocale).toBe('ru')
  })

  it('normalizes unsupported locales to default locale', () => {
    const workspace = new EndgeWorkspace()

    expect(workspace.normalizeLocale('ru')).toBe('ru')
    expect(workspace.normalizeLocale('en')).toBe('en')
    expect(workspace.normalizeLocale('kk')).toBe('ru')
    expect(workspace.normalizeLocale(null)).toBe('ru')
  })

  it('returns locale labels by mode', () => {
    const workspace = new EndgeWorkspace()

    expect(workspace.getLocaleLabel('ru', 'nativeLabel')).toBe('Русский')
    expect(workspace.getLocaleLabel('en', 'shortLabel')).toBe('EN')
    expect(workspace.getLocaleLabel('kk', 'shortLabel')).toBe('kk')
  })
})
