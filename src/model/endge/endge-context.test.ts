import { describe, expect, it, vi } from 'vitest'

import { EndgeContext } from '@/model/endge/endge-context'

describe('EndgeContext locale', () => {
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
})
