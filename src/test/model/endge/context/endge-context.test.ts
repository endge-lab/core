import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/model/endge/kernel/endge'
import { EndgeContext } from '@/model/endge/context/endge-context'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeContext locale', () => {
  beforeEach(() => {
    Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
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
    Endge.workspace.reset()
    const context = new EndgeContext()
    context.deserialize({ project: null, environment: 'dev', locale: 'kk' })

    Endge.workspace.apply({
      ...TEST_ENDGE_WORKSPACE,
      locales: [
        ...TEST_ENDGE_WORKSPACE.locales,
        { code: 'kk', displayName: 'Қазақша', shortLabel: 'KK' },
      ],
      defaultLocale: 'kk',
    })
    context.reconcileCurrentLocaleWithWorkspace()

    expect(context.currentLocale).toBe('kk')
  })
})
