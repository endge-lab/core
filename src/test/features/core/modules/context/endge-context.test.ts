import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('локаль и тема EndgeContext', () => {
  beforeEach(() => {
    Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
  })

  it('использует en, если сохранённая локаль не задана', () => {
    const context = new EndgeContext_Module()

    context.deserialize(undefined)

    expect(context.currentLocale).toBe('en')
  })

  it('использует en до загрузки Workspace', () => {
    Endge.workspace.reset()
    const context = new EndgeContext_Module()

    context.deserialize(undefined)

    expect(context.currentLocale).toBe('en')
  })

  it('использует dark, если сохранённая тема не задана', () => {
    const context = new EndgeContext_Module()

    context.deserialize(undefined)

    expect(context.currentTheme).toBe('dark')
  })

  it('использует dark до загрузки Workspace', () => {
    Endge.workspace.reset()
    const context = new EndgeContext_Module()

    context.deserialize(undefined)

    expect(context.currentTheme).toBe('dark')
  })

  it('сохраняет поддерживаемые записанные локали', () => {
    const context = new EndgeContext_Module()

    context.deserialize({ locale: 'en' })
    expect(context.currentLocale).toBe('en')

    context.deserialize({ locale: 'ru' })
    expect(context.currentLocale).toBe('ru')
  })

  it('приводит неподдерживаемые записанные локали к ru', () => {
    const context = new EndgeContext_Module()

    context.deserialize({ locale: 'kk' })
    context.reconcileCurrentLocaleWithWorkspace()

    expect(context.currentLocale).toBe('ru')
  })

  it('уведомляет подписчиков при изменении локали', () => {
    const context = new EndgeContext_Module()
    context.deserialize(undefined)
    const listener = vi.fn()

    const off = context.subscribe(listener)
    context.setCurrentLocale('ru')
    off()

    expect(context.currentLocale).toBe('ru')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('нормализует неподдерживаемые обновления локали к ru', () => {
    const context = new EndgeContext_Module()
    context.deserialize({ locale: 'en' })

    context.setCurrentLocale('kk')

    expect(context.currentLocale).toBe('ru')
  })

  it('сохраняет поддерживаемые темы и нормализует неподдерживаемые обновления', () => {
    const context = new EndgeContext_Module()
    const listener = vi.fn()
    context.deserialize(undefined)

    const off = context.subscribe(listener)
    context.setCurrentTheme('dark')
    context.setCurrentTheme('missing')
    off()

    expect(context.currentTheme).toBe('light')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('согласует сохранённую локаль после загрузки локалей Workspace', () => {
    Endge.workspace.reset()
    const context = new EndgeContext_Module()
    context.deserialize({ locale: 'kk' })

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

  it('согласует сохранённую тему после загрузки тем Workspace', () => {
    Endge.workspace.reset()
    const context = new EndgeContext_Module()
    context.deserialize({ theme: 'contrast' })

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

describe('разрешение контекста выполнения EndgeContext', () => {
  const candidates = {
    facets: [
      { identity: 'region', position: 1, documents: ['west', 'east'] },
      { identity: 'channel', position: 0, documents: ['web', 'mobile'] },
    ],
  } as const

  it('использует первые доступные документы для устаревших сохранённых координат', () => {
    const context = new EndgeContext_Module()
    context.deserialize({ facets: { region: 'removed', obsolete: 'old' } })

    expect(context.resolveExecutionContext(candidates)).toEqual({
      facets: { channel: 'mobile', region: 'east' },
    })
  })

  it('сохраняет валидные записанные координаты в порядке фасетов', () => {
    const context = new EndgeContext_Module()
    context.deserialize({ facets: { region: 'west', channel: 'web' } })

    expect(context.resolveExecutionContext(candidates)).toEqual({
      facets: { channel: 'web', region: 'west' },
    })
  })

  it('отклоняет явно запрошенный недоступный документ фасета', () => {
    const context = new EndgeContext_Module()

    expect(() => context.resolveExecutionContext({
      ...candidates,
      explicit: { facets: { region: 'missing' } },
    })).toThrow('[EndgeContext] Facet "region" "missing" was not found in loaded Domain')
  })

  it('отклоняет явно запрошенный неизвестный фасет', () => {
    const context = new EndgeContext_Module()

    expect(() => context.resolveExecutionContext({
      ...candidates,
      explicit: { facets: { missing: 'value' } },
    })).toThrow('[EndgeContext] explicit Facet "missing" was not found in loaded Domain')
  })
})
