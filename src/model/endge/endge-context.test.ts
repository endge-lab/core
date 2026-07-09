import { afterEach, describe, expect, it, vi } from 'vitest'

import { EndgeContext } from '@/model/endge/endge-context'
import { DEFAULT_ENDGE_WORKSPACE, setActiveEndgeWorkspace } from '@/model/config/endge-workspace'

describe('EndgeContext locale', () => {
  afterEach(() => {
    setActiveEndgeWorkspace(DEFAULT_ENDGE_WORKSPACE)
  })

  it('uses ru as the default locale', () => {
    const context = new EndgeContext()

    context.deserialize(undefined)

    expect(context.currentLocale).toBe('ru')
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

  it('reconciles stored locale after workspace locales are loaded', () => {
    const context = new EndgeContext()
    context.deserialize({ project: null, environment: 'dev', locale: 'kk' })

    setActiveEndgeWorkspace({
      ...DEFAULT_ENDGE_WORKSPACE,
      locales: [
        ...DEFAULT_ENDGE_WORKSPACE.locales,
        { code: 'kk', displayName: 'Қазақша', shortLabel: 'KK' },
      ],
      defaultLocale: 'kk',
    })
    context.reconcileCurrentLocaleWithWorkspace()

    expect(context.currentLocale).toBe('kk')
  })
})
