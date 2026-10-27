import type { EndgeAuthBootOptions } from '@/features/core/modules/auth/domain/types/auth-profile.types'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import {
  normalizeFacetClaimMappings,
  readClaim,
  resolveFacetSelectionsFromClaims,
} from '@/features/core/modules/auth/services/auth-facet-claims'
import { createTenantInspectorBundle } from '@/test/fixtures/tenant-inspector-bundle'

function signIn(claims: Record<string, unknown> | null): void {
  vi.spyOn(Endge.auth.session, 'context', 'get').mockReturnValue(claims
    ? { authenticated: true, subject: 'user-1', profileIdentity: 'oidc' }
    : { authenticated: false })
  vi.spyOn(Endge.auth.session, 'claims', 'get').mockReturnValue(claims ?? {})
}

async function boot(auth: EndgeAuthBootOptions, facets?: Record<string, string>): Promise<void> {
  vi.spyOn(Endge.bridge, 'start').mockImplementation(() => {})
  await Endge.boot({
    dataProvider: 'bundle',
    scope: { workspaceIdentity: 'tenant-inspector' },
    vars: {},
    bundleSource: createTenantInspectorBundle(),
    auth,
    ...(facets ? { context: { facets } } : {}),
  })
}

describe('выбор документа фасета по claims session', () => {
  it('читает claim по JSON Pointer и по имени, сопоставляет через map и массивы', () => {
    const claims = { 'tenant': 'afl', 'org': { 'tenant/code': 'KZN-01' }, 'groups': ['staff', 'tenant-kzn'], 'a~b': 1 }
    expect(readClaim(claims, 'tenant')).toBe('afl')
    expect(readClaim(claims, '/org/tenant~1code')).toBe('KZN-01')
    expect(readClaim(claims, '/groups/1')).toBe('tenant-kzn')
    expect(readClaim(claims, '/a~0b')).toBe(1)
    expect(readClaim(claims, '/org/missing')).toBeUndefined()

    const mappings = normalizeFacetClaimMappings({
      tenant: { claim: '/org/tenant~1code', map: { 'KZN-01': 'kzn' } },
      region: { claim: '/groups', map: { 'tenant-kzn': 'volga' } },
      stage: { claim: 'stage', missing: 'error' },
      airline: { claim: 'tenant', map: { svo: 'afl' } },
    })
    expect(resolveFacetSelectionsFromClaims(mappings, claims, true)).toEqual({
      selections: { tenant: 'kzn', region: 'volga' },
      issues: [
        { facet: 'stage', claim: 'stage', reason: 'missing', missing: 'error' },
        { facet: 'airline', claim: 'tenant', reason: 'unmapped', missing: 'default' },
      ],
    })
    // Без авторизованной session claims не фиксируют фасеты и не считаются отсутствующими.
    expect(resolveFacetSelectionsFromClaims(mappings, claims, false)).toEqual({ selections: {}, issues: [] })
  })

  it('отклоняет некорректную опцию boot', () => {
    expect(() => normalizeFacetClaimMappings({ tenant: { claim: ' ' } })).toThrow(/non-empty facet and claim/)
    expect(() => normalizeFacetClaimMappings({ tenant: { claim: '/t', missing: 'skip' as never } })).toThrow(/missing/)
    expect(() => normalizeFacetClaimMappings({ tenant: { claim: '/t', map: { a: '' } } })).toThrow(/document identity/)
  })
})

describe('endge.boot с auth.facetClaims', () => {
  afterEach(async () => {
    await Endge.reset()
    vi.restoreAllMocks()
  })

  it('claim авторизованной session выбирает тенант и сильнее явного context', async () => {
    signIn({ sub: 'user-1', org: { tenant: 'KZN-01' } })
    await boot({ facetClaims: { tenant: { claim: '/org/tenant', map: { 'AFL-01': 'afl', 'KZN-01': 'kzn' } } } }, { tenant: 'afl' })

    expect(Endge.context.getFacetSelections()).toEqual({ tenant: 'kzn' })
    expect(Endge.context.isFacetLockedBySession('tenant')).toBe(true)
    expect(Endge.configuration.current.values.inspector?.title).toBe('Инспектор КЗН')
    expect(Endge.context.getCurrentUser()).toBe('user-1')
  })

  it('missing: default — без claim остаётся выбор boot и пишется warning', async () => {
    signIn({ sub: 'user-1' })
    const warn = vi.spyOn(Endge.diagnostics, 'warn')
    await boot({ facetClaims: { tenant: { claim: '/org/tenant' } } }, { tenant: 'afl' })

    expect(Endge.context.getFacetSelections()).toEqual({ tenant: 'afl' })
    expect(Endge.context.isFacetLockedBySession('tenant')).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Facet "tenant" claim "/org/tenant" is missing'),
      expect.objectContaining({ eventName: 'endge.auth.facet-claim' }),
    )
  })

  it('missing: error — boot завершается ошибкой, если claim нет или значение не сопоставлено', async () => {
    signIn({ sub: 'user-1', org: { tenant: 'UNKNOWN' } })
    await expect(boot({ facetClaims: { tenant: { claim: '/org/tenant', map: { 'KZN-01': 'kzn' }, missing: 'error' } } }))
      .rejects
      .toThrow('Facet "tenant" claim "/org/tenant" has no mapped facet document in the authenticated session')
  })

  it('claim с документом, которого нет в Domain, — ошибка boot', async () => {
    signIn({ sub: 'user-1', tenant: 'spb' })
    await expect(boot({ facetClaims: { tenant: { claim: 'tenant' } } })).rejects.toThrow(/spb/)
  })

  it('без авторизованной session фасет выбирается boot context', async () => {
    signIn(null)
    await boot({ facetClaims: { tenant: { claim: 'tenant', missing: 'error' } } }, { tenant: 'kzn' })
    expect(Endge.context.getFacetSelections()).toEqual({ tenant: 'kzn' })
  })
})
