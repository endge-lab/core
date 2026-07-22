import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/model/endge/kernel/endge'
import { EndgeContext } from '@/model/endge/context/endge-context'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeContext locale and theme', () => {
  beforeEach(() => {
    Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  })

  it('uses en when the stored locale is not set', () => {
    const context = new EndgeContext()

    context.deserialize(undefined)

    expect(context.currentLocale).toBe('en')
  })

  it('uses en before the workspace is loaded', () => {
    Endge.workspace.reset()
    const context = new EndgeContext()

    context.deserialize(undefined)

    expect(context.currentLocale).toBe('en')
  })

  it('uses dark when the stored theme is not set', () => {
    const context = new EndgeContext()

    context.deserialize(undefined)

    expect(context.currentTheme).toBe('dark')
  })

  it('uses dark before the workspace is loaded', () => {
    Endge.workspace.reset()
    const context = new EndgeContext()

    context.deserialize(undefined)

    expect(context.currentTheme).toBe('dark')
  })

  it('keeps supported stored locales', () => {
    const context = new EndgeContext()

    context.deserialize({ project: null, environment: 'dev', locale: 'en' })
    expect(context.currentLocale).toBe('en')

    context.deserialize({ project: null, environment: 'dev', locale: 'ru' })
    expect(context.currentLocale).toBe('ru')
  })

  it('normalizes unsupported stored locales to ru', () => {
    const context = new EndgeContext()

    context.deserialize({ project: null, environment: 'dev', locale: 'kk' })

    expect(context.currentLocale).toBe('ru')
  })

  it('notifies subscribers when locale changes', () => {
    const context = new EndgeContext()
    context.deserialize(undefined)
    const listener = vi.fn()

    const off = context.subscribe(listener)
    context.setCurrentLocale('en')
    off()

    expect(context.currentLocale).toBe('en')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('normalizes unsupported locale updates to ru', () => {
    const context = new EndgeContext()
    context.deserialize({ project: null, environment: 'dev', locale: 'en' })

    context.setCurrentLocale('kk')

    expect(context.currentLocale).toBe('ru')
  })

  it('stores supported themes and normalizes unsupported updates', () => {
    const context = new EndgeContext()
    const listener = vi.fn()
    context.deserialize(undefined)

    const off = context.subscribe(listener)
    context.setCurrentTheme('dark')
    context.setCurrentTheme('missing')
    off()

    expect(context.currentTheme).toBe('light')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('reconciles stored locale after workspace locales are loaded', () => {
    Endge.workspace.reset()
    const context = new EndgeContext()
    context.deserialize({ project: null, environment: 'dev', locale: 'kk' })

    Endge.workspace.apply({
      ...TEST_ENDGE_WORKSPACE,
      configuration: {
        ...TEST_ENDGE_WORKSPACE.configuration,
        locales: [
          ...TEST_ENDGE_WORKSPACE.configuration.locales,
          { code: 'kk', displayName: 'Қазақша', shortLabel: 'KK' },
        ],
        defaultLocale: 'kk',
      },
    })
    context.reconcileCurrentLocaleWithWorkspace()

    expect(context.currentLocale).toBe('kk')
  })

  it('reconciles a stored theme after workspace themes are loaded', () => {
    Endge.workspace.reset()
    const context = new EndgeContext()
    context.deserialize({ project: null, environment: 'dev', theme: 'contrast' })

    Endge.workspace.apply({
      ...TEST_ENDGE_WORKSPACE,
      configuration: {
        ...TEST_ENDGE_WORKSPACE.configuration,
        themes: [
          ...TEST_ENDGE_WORKSPACE.configuration.themes,
          { identity: 'contrast', displayName: 'Контрастная' },
        ],
        defaultTheme: 'contrast',
      },
    })
    context.reconcileCurrentThemeWithWorkspace()

    expect(context.currentTheme).toBe('contrast')
  })
})

describe('EndgeContext execution context resolution', () => {
  const candidates = {
    tenants: ['tenant-a', 'tenant-b'],
    projects: [
      { identity: 'project-a', allowedEnvironmentIds: [2] },
      { identity: 'project-b', allowedEnvironmentIds: [] },
    ],
    environments: [
      { id: 1, identity: 'development' },
      { id: 2, identity: 'production' },
    ],
  } as const

  it('falls back to the first available entities for stale stored coordinates', () => {
    const context = new EndgeContext()
    context.deserialize({ tenant: 'removed', project: 'removed', environment: 'removed' })

    expect(context.resolveExecutionContext(candidates)).toEqual({
      tenantIdentity: 'tenant-a',
      projectIdentity: 'project-a',
      environmentIdentity: 'production',
    })
  })

  it('keeps valid stored coordinates', () => {
    const context = new EndgeContext()
    context.deserialize({ tenant: 'tenant-b', project: 'project-b', environment: 'development' })

    expect(context.resolveExecutionContext(candidates)).toEqual({
      tenantIdentity: 'tenant-b',
      projectIdentity: 'project-b',
      environmentIdentity: 'development',
    })
  })

  it('rejects an explicitly requested coordinate that is not available', () => {
    const context = new EndgeContext()

    expect(() => context.resolveExecutionContext({
      ...candidates,
      explicit: { projectIdentity: 'missing-project' },
    })).toThrow('[EndgeContext] Project "missing-project" was not found in loaded Domain')
  })

  it('rejects an explicitly requested environment outside the selected project', () => {
    const context = new EndgeContext()

    expect(() => context.resolveExecutionContext({
      ...candidates,
      explicit: {
        projectIdentity: 'project-a',
        environmentIdentity: 'development',
      },
    })).toThrow('[EndgeContext] Environment for Project "project-a" "development" was not found in loaded Domain')
  })
})
