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

  it('resolves project, environment and tenant contributions in order', () => {
    const workspace = createDefaultEndgeConfiguration()
    const project = applyEndgeConfigurationContribution(workspace, {
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
    const tenant = applyEndgeConfigurationContribution(environment, {
      mode: 'inherit',
      patch: {
        vars: { entries: [{ key: 'ACCENT', op: 'remove' }] },
      },
    })

    expect(workspace.vars).toEqual([])
    expect(project.vars).toEqual([{ name: 'ACCENT', defaultValue: 'project' }])
    expect(environment.vars).toEqual([{ name: 'ACCENT', defaultValue: 'environment' }])
    expect(tenant.vars).toEqual([])
  })

  it('creates a deterministic context hash', () => {
    expect(createEndgeContextHash({ b: 2, a: 1 })).toBe(createEndgeContextHash({ a: 1, b: 2 }))
  })
})
