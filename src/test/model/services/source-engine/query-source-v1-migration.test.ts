import { describe, expect, it } from 'vitest'

import { compileQuerySource } from '@/model/services/source-engine/compilers/query-source-compile'
import { migrateQuerySourceV1ToV2 } from '@/model/services/source-engine/migrations/query-source-v1-migration'

describe('Query source v1 migration', () => {
  it('migrates an empty legacy params/filter contract and preserves response contract', () => {
    const result = migrateQuerySourceV1ToV2(`defineQuery({
  kind: 'rest',
  request: { endpoint: '', path: '', method: 'POST', auth: { mode: 'inherit' } },
  params: {},
  filters: { mode: 'merge', items: [] },
  response: { subField: '', return: field('null') },
  mock: { enabled: false, data: '' },
})`)

    expect(result.ok).toBe(true)
    if (!result.ok)
      return

    expect(result.sourceVersion).toBe(2)
    expect(result.source).toContain('.from(response())')
    expect(result.source).toContain(".contract(field('null'))")
    expect(compileQuerySource(result.source).diagnostics).toEqual([])
  })

  it('refuses to normalize a legacy token auth mode', () => {
    const result = migrateQuerySourceV1ToV2(`defineQuery({
  request: { endpoint: '', auth: { mode: 'token' } },
  params: {},
  filters: { items: [] },
})`)

    expect(result).toMatchObject({ ok: false, code: 'query_v1_auth_migration_required' })
  })

  it('refuses a lossy automatic migration of non-empty legacy filters', () => {
    const result = migrateQuerySourceV1ToV2(`defineQuery({
  request: {},
  params: {},
  filters: { items: [filter.inline({ active: true })] },
})`)

    expect(result).toMatchObject({ ok: false, code: 'query_v1_filters_migration_required' })
  })
})
