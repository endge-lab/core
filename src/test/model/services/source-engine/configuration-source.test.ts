import { describe, expect, it } from 'vitest'

import {
  applyEndgeConfigurationContribution,
  compileConfigurationSource,
  createDefaultEndgeConfiguration,
  createEndgePublicConfigurationSnapshot,
  inferConfigurationDefault,
  patchConfigurationSource,
  validateConfigurationValue,
} from '@/main'

describe('Configuration Source v1', () => {
  it('compiles explicit and inferred defaults including JSON and an empty TriggerSet', () => {
    const result = compileConfigurationSource(`defineConfig({
  title: value(String),
  count: value(Number).min(0).max(10).step(1),
  options: value(JSON, { compact: true }),
  triggers: value(TriggerSet, []),
})`)

    expect(result.diagnostics).toEqual([])
    expect(result.document?.values.map(item => [item.key, item.defaultValue])).toEqual([
      ['title', ''],
      ['count', 0],
      ['options', { compact: true }],
      ['triggers', []],
    ])
  })

  it('rejects executable syntax and unsafe/computed values', () => {
    for (const source of [
      `import x from 'x'; defineConfig({ a: value(String, x) })`,
      `defineConfig({ ...other })`,
      `defineConfig({ [key]: value(String, '') })`,
      `defineConfig({ value: value(JSON, (() => ({}))()) })`,
    ]) {
      expect(compileConfigurationSource(source).diagnostics.some(item => item.severity === 'error')).toBe(true)
    }
  })

  it('patches only one property and preserves neighboring source', () => {
    const source = `defineConfig({
  first: value(String, 'keep'),
  second: value(Number, 1).label('Old'),
})`
    const next = patchConfigurationSource(source, {
      op: 'upsert',
      value: {
        key: 'second',
        type: { kind: 'reference', identity: 'Number' },
        defaultValue: 32,
        defaultWasInferred: false,
        label: 'Height',
        min: 24,
      },
    })
    expect(next).toContain(`first: value(String, 'keep')`)
    expect(next).toContain('second: value(Number, 32)')
    expect(next).toContain('.min(24)')
    expect(compileConfigurationSource(next).diagnostics).toEqual([])
    const removed = patchConfigurationSource(next, { op: 'remove', key: 'second' })
    expect(compileConfigurationSource(removed).document?.values.map(item => item.key)).toEqual(['first'])
  })

  it('validates full TriggerSet semantics', () => {
    const type = { kind: 'reference' as const, identity: 'TriggerSet' }
    expect(validateConfigurationValue(type, [], []).ok).toBe(true)
    expect(validateConfigurationValue(type, [{ event: 'contextmenu', button: 2, prevent: true }], []).ok).toBe(true)
    expect(validateConfigurationValue(type, [{ event: 'keydown', code: ['KeyT'], modifiers: { mod: true }, held: { code: ['Space'], match: 'all' } }], []).ok).toBe(true)
    expect(validateConfigurationValue(type, [{ event: 'click', passive: true, prevent: true }], []).ok).toBe(false)
  })

  it('requires explicit defaults for references and ambiguous empty schemas', () => {
    const catalog = [{
      id: 1,
      identity: 'FlightRef',
      displayName: 'Flight',
      category: 'reference' as const,
      sourceVersion: 1,
      definition: null,
      status: 'valid' as const,
    }]
    expect(inferConfigurationDefault({ kind: 'reference', identity: 'FlightRef' }, catalog).ok).toBe(false)
    expect(inferConfigurationDefault({ kind: 'enum', values: [] }, catalog).ok).toBe(false)
    expect(inferConfigurationDefault({ kind: 'object', fields: [] }, catalog)).toEqual({ ok: true, value: {} })
  })
})

describe('configuration cascade and public context', () => {
  it('applies field-level set/remove semantics without losing sibling values', () => {
    const root = createDefaultEndgeConfiguration()
    root.values = { groundHandling: { rowHeight: 32, compact: true } }
    const overridden = applyEndgeConfigurationContribution(root, {
      mode: 'inherit',
      patch: { values: { groundHandling: { rowHeight: { op: 'set', value: 40 } } } },
    })
    expect(overridden.values).toEqual({ groundHandling: { rowHeight: 40, compact: true } })
    const inherited = applyEndgeConfigurationContribution(overridden, {
      mode: 'inherit',
      patch: { values: { groundHandling: { rowHeight: { op: 'remove' } } } },
    })
    expect(inherited.values).toEqual({ groundHandling: { rowHeight: 40, compact: true } })
  })

  it('publishes a deeply frozen flat config without storage internals', () => {
    const configuration = createDefaultEndgeConfiguration()
    configuration.values = { groundHandling: { actualTimeTriggers: [] } }
    const snapshot = createEndgePublicConfigurationSnapshot(configuration)
    expect(snapshot.groundHandling).toEqual({ actualTimeTriggers: [] })
    expect(snapshot).not.toHaveProperty('values')
    expect(snapshot).not.toHaveProperty('vars')
    expect(snapshot).not.toHaveProperty('diagnostics')
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.groundHandling)).toBe(true)
  })
})
