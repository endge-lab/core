import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/model/endge/kernel/endge'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeWorkspace', () => {
  const payloadContext: EndgeBootContext = {
    dataProvider: 'payload',
    scope: {},
    vars: {},
    payload: { baseAPI: 'https://payload.test/api', secret: 'test-secret' },
  }

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('exposes the applied Payload workspace', () => {
    const workspace = Endge.workspace
    workspace.apply(TEST_ENDGE_WORKSPACE)

    expect(workspace.locales.map(locale => locale.code)).toEqual(['en', 'ru'])
    expect(workspace.defaultLocale).toBe('ru')
    expect(workspace.fallbackLocale).toBe('ru')
    expect(workspace.themes.map(theme => theme.identity)).toEqual(['light', 'dark'])
    expect(workspace.defaultTheme).toBe('light')
    expect(workspace.sfcAdapterIds).toEqual(['native-vue'])
    expect(workspace.defaultSfcAdapterId).toBe('native-vue')
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

  it('fails before a Payload workspace is applied', () => {
    const workspace = Endge.workspace
    workspace.reset()

    expect(() => workspace.current).toThrow('Workspace has not been loaded from Payload')
  })

  it('selects the only workspace returned by Payload', () => {
    Endge.context.setCurrentWorkspace(null)
    vi.spyOn(Endge.schema, 'getLoadedSource').mockReturnValue({
      workspaces: [TEST_ENDGE_WORKSPACE],
    } as never)

    Endge.workspace.build(payloadContext)

    expect(Endge.workspace.current.identity).toBe(TEST_ENDGE_WORKSPACE.identity)
  })

  it('requires an explicit identity when Payload returns multiple workspaces', () => {
    Endge.context.setCurrentWorkspace(null)
    vi.spyOn(Endge.schema, 'getLoadedSource').mockReturnValue({
      workspaces: [
        TEST_ENDGE_WORKSPACE,
        { ...TEST_ENDGE_WORKSPACE, identity: 'workspace-b' },
      ],
    } as never)

    expect(() => Endge.workspace.build(payloadContext)).toThrow('explicit workspace identity')
  })

  it('selects the workspace requested by boot scope', () => {
    Endge.context.setCurrentWorkspace(null)
    vi.spyOn(Endge.schema, 'getLoadedSource').mockReturnValue({
      workspaces: [
        TEST_ENDGE_WORKSPACE,
        { ...TEST_ENDGE_WORKSPACE, identity: 'workspace-b' },
      ],
    } as never)

    Endge.workspace.build({
      ...payloadContext,
      scope: { workspaceIdentity: 'workspace-b' },
    })

    expect(Endge.workspace.current.identity).toBe('workspace-b')
  })
})
