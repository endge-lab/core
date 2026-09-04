import type { EndgeConfigurationContribution } from '@/modules/configuration/domain/types/configuration.type'

import { describe, expect, it } from 'vitest'
import {
  applyEndgeConfigurationContribution,
  createDefaultEndgeConfiguration,
  createEndgeContextHash,
  normalizeEndgeConfiguration,
} from '@/modules/configuration/domain/endge-configuration'

describe('каскад Configuration Endge', () => {
  it('использует локаль en и тёмную тему, если значения по умолчанию не заданы', () => {
    const configuration = createDefaultEndgeConfiguration()
    const result = normalizeEndgeConfiguration({
      ...configuration,
      defaultLocale: undefined,
      fallbackLocale: undefined,
      defaultTheme: undefined,
    })

    expect(result.defaultLocale).toBe('en')
    expect(result.fallbackLocale).toBe('en')
    expect(result.defaultTheme).toBe('dark')
  })

  it('применяет upsert по ключам, удаления и скалярные переопределения', () => {
    const contribution: EndgeConfigurationContribution = {
      mode: 'inherit',
      patch: {
        themes: {
          entries: [
            { key: 'dark', op: 'remove' },
            { key: 'airport', op: 'upsert', value: { identity: 'airport', displayName: 'Airport' } },
          ],
        },
        defaultTheme: { op: 'set', value: 'airport' },
      },
    }

    const result = applyEndgeConfigurationContribution(createDefaultEndgeConfiguration(), contribution)
    expect(result.themes.map(item => item.identity)).toEqual(['light', 'airport'])
    expect(result.defaultTheme).toBe('airport')
  })

  it('сбрасывает накопленные значения в режиме replace', () => {
    const replacement = createDefaultEndgeConfiguration()
    replacement.vars = [{ name: 'ONLY', defaultValue: 'replacement' }]
    const result = applyEndgeConfigurationContribution(
      { ...createDefaultEndgeConfiguration(), vars: [{ name: 'OLD', defaultValue: 'upstream' }] },
      { mode: 'replace', value: replacement },
    )
    expect(result.vars).toEqual([{ name: 'ONLY', defaultValue: 'replacement' }])
  })

  it('последовательно разрешает вклады Workspace, Tenant, Project и Environment', () => {
    const workspace = createDefaultEndgeConfiguration()
    const tenant = applyEndgeConfigurationContribution(workspace, {
      mode: 'inherit',
      patch: {
        vars: { entries: [{ key: 'ACCENT', op: 'upsert', value: { name: 'ACCENT', defaultValue: 'tenant' } }] },
      },
    })
    const project = applyEndgeConfigurationContribution(tenant, {
      mode: 'inherit',
      patch: {
        vars: { entries: [{ key: 'ACCENT', op: 'upsert', value: { name: 'ACCENT', defaultValue: 'project' } }] },
      },
    })
    const environment = applyEndgeConfigurationContribution(project, {
      mode: 'inherit',
      patch: {
        vars: { entries: [{ key: 'ACCENT', op: 'upsert', value: { name: 'ACCENT', defaultValue: 'environment' } }] },
      },
    })

    expect(workspace.vars).toEqual([])
    expect(tenant.vars).toEqual([{ name: 'ACCENT', defaultValue: 'tenant' }])
    expect(project.vars).toEqual([{ name: 'ACCENT', defaultValue: 'project' }])
    expect(environment.vars).toEqual([{ name: 'ACCENT', defaultValue: 'environment' }])
  })

  it('добавляет значения диагностики по умолчанию в legacy Configuration и объединяет patches коллекций', () => {
    const defaults = createDefaultEndgeConfiguration()
    const result = applyEndgeConfigurationContribution(defaults, {
      mode: 'inherit',
      patch: {
        diagnostics: {
          telemetry: {
            collection: {
              minSeverity: { op: 'set', value: 17 },
              maxRecords: { op: 'set', value: 250 },
            },
          },
        },
      },
    })

    expect(defaults.diagnostics.telemetry.collection).toEqual({
      enabled: true,
      signals: ['log', 'span'],
      minSeverity: 9,
      maxRecords: 2_000,
    })
    expect(result.diagnostics.telemetry.collection).toEqual({
      enabled: true,
      signals: ['log', 'span'],
      minSeverity: 17,
      maxRecords: 250,
    })
  })

  it('объединяет outputs, routes и политику автоматических snapshots по слоям каскада', () => {
    const result = applyEndgeConfigurationContribution(createDefaultEndgeConfiguration(), {
      mode: 'inherit',
      patch: {
        diagnostics: {
          telemetry: {
            outputs: {
              entries: [{
                key: 'output-2',
                op: 'upsert',
                value: { id: 'output-2', name: 'JSON', enabled: true, adapterType: 'console', options: { format: 'json' } },
              }],
            },
            routes: {
              entries: [{
                key: 'build-errors',
                op: 'upsert',
                value: { id: 'build-errors', name: 'Build errors', enabled: true, match: { phases: ['build'], minSeverity: 17 }, outputId: 'output-2' },
              }],
            },
          },
          snapshots: {
            automatic: {
              enabled: { op: 'set', value: true },
              outputIds: { entries: [{ key: 'output-2', op: 'upsert', value: 'output-2' }] },
            },
          },
        },
      },
    })

    expect(result.diagnostics.telemetry.outputs.map(output => output.id)).toEqual(['output-1', 'output-2'])
    expect(result.diagnostics.telemetry.routes.some(route => route.id === 'build-errors')).toBe(true)
    expect(result.diagnostics.snapshots.automatic).toMatchObject({ enabled: true, outputIds: ['output-1', 'output-2'] })
  })

  it('создаёт детерминированный hash контекста', () => {
    expect(createEndgeContextHash({ b: 2, a: 1 })).toBe(createEndgeContextHash({ a: 1, b: 2 }))
  })

  it('добавляет значения tooltip по умолчанию в legacy-документы Configuration', () => {
    const configuration = createDefaultEndgeConfiguration()
    const result = normalizeEndgeConfiguration({ ...configuration, tooltips: undefined })

    expect(result.tooltips).toEqual({
      side: 'right',
      align: 'start',
      openDelay: 250,
      closeDelay: 100,
    })
  })

  it('независимо объединяет поля tooltip между слоями каскада', () => {
    const workspace = createDefaultEndgeConfiguration()
    const tenant = applyEndgeConfigurationContribution(workspace, {
      mode: 'inherit',
      patch: { tooltips: { side: { op: 'set', value: 'bottom' } } },
    })
    const project = applyEndgeConfigurationContribution(tenant, {
      mode: 'inherit',
      patch: { tooltips: { openDelay: { op: 'set', value: 500 } } },
    })
    const environment = applyEndgeConfigurationContribution(project, {
      mode: 'inherit',
      patch: { tooltips: { align: { op: 'set', value: 'center' }, closeDelay: { op: 'set', value: 0 } } },
    })

    expect(environment.tooltips).toEqual({ side: 'bottom', align: 'center', openDelay: 500, closeDelay: 0 })
    expect(workspace.tooltips.side).toBe('right')
  })

  it('отклоняет невалидное поведение tooltip', () => {
    const configuration = createDefaultEndgeConfiguration()
    expect(() => normalizeEndgeConfiguration({
      ...configuration,
      tooltips: { ...configuration.tooltips, openDelay: -1 },
    })).toThrow('tooltips.openDelay')
    expect(() => normalizeEndgeConfiguration({
      ...configuration,
      tooltips: { ...configuration.tooltips, side: 'diagonal' },
    })).toThrow('tooltips.side')
  })
})
