// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'

describe('модули Core', () => {
  it('сохраняет dependency order модулей', () => {
    const keys = ENDGE_CORE_MODULES.map(item => item.key)

    expect(keys.indexOf('domainRepository')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('domain')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('workspace')).toBeGreaterThanOrEqual(0)
    expect(keys.indexOf('context')).toBeLessThan(keys.indexOf('workspace'))
    expect(keys.indexOf('domainRepository')).toBeLessThan(keys.indexOf('domain'))
    expect(keys.indexOf('domain')).toBeLessThan(keys.indexOf('compiler'))
    expect(keys.indexOf('compiler')).toBeLessThan(keys.indexOf('runtime'))
  })
})
