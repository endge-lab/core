import { describe, expect, it } from 'vitest'

import { compileQuerySource } from '@/modules/source/services/compilers/query-source-compile'
import { migrateQuerySourceV1ToV2 } from '@/modules/source/services/migrations/query-source-v1-migration'

describe('миграция Source Query v1', () => {
  it('мигрирует пустой legacy-контракт params/filter и сохраняет контракт response', () => {
    const result = migrateQuerySourceV1ToV2(`defineQuery({
  kind: 'rest',
  request: { endpoint: '', path: '', method: 'POST', auth: { mode: 'inherit' } },
  params: {},
  filters: { mode: 'merge', items: [] },
  response: { subField: '', return: field('null') },
  mock: { enabled: false, data: '' },
})`)

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }

    expect(result.sourceVersion).toBe(2)
    expect(result.source).toContain('.from(response())')
    expect(result.source).toContain('.contract(field(\'null\'))')
    expect(compileQuerySource(result.source).diagnostics).toEqual([])
  })

  it('отказывается нормализовать legacy-режим авторизации token', () => {
    const result = migrateQuerySourceV1ToV2(`defineQuery({
  request: { endpoint: '', auth: { mode: 'token' } },
  params: {},
  filters: { items: [] },
})`)

    expect(result).toMatchObject({ ok: false, code: 'query_v1_auth_migration_required' })
  })

  it('отказывается от автоматической миграции непустых legacy filters с потерями', () => {
    const result = migrateQuerySourceV1ToV2(`defineQuery({
  request: {},
  params: {},
  filters: { items: [filter.inline({ active: true })] },
})`)

    expect(result).toMatchObject({ ok: false, code: 'query_v1_filters_migration_required' })
  })
})
