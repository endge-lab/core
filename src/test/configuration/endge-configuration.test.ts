import { describe, expect, it } from 'vitest'

import type { EndgeConfigurationContribution } from '@/domain/types/configuration'
import {
  applyEndgeConfigurationContribution,
  createDefaultEndgeConfiguration,
  createEndgeContextHash,
} from '@/model/services/configuration'

describe('Endge configuration cascade', () => {
  it('applies keyed upserts, removals and scalar overrides', () => {
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

  it('resets accumulated values in replace mode', () => {
    const replacement = createDefaultEndgeConfiguration()
    replacement.vars = [{ name: 'ONLY', defaultValue: 'replacement' }]
    const result = applyEndgeConfigurationContribution(
      { ...createDefaultEndgeConfiguration(), vars: [{ name: 'OLD', defaultValue: 'upstream' }] },
      { mode: 'replace', value: replacement },
    )
    expect(result.vars).toEqual([{ name: 'ONLY', defaultValue: 'replacement' }])
  })

  it('resolves workspace, tenant, project and environment contributions in order', () => {
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

  it('adds diagnostics defaults to legacy configuration and merges collection patches', () => {
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

  it('merges outputs, routes and automatic snapshot policy by cascade layer', () => {
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

  it('creates a deterministic context hash', () => {
    expect(createEndgeContextHash({ b: 2, a: 1 })).toBe(createEndgeContextHash({ a: 1, b: 2 }))
  })
})
