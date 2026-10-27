import type {
  EndgeFacetClaimIssue,
  EndgeFacetClaimMapping,
  EndgeFacetClaimResolution,
} from '@/features/core/modules/auth/domain/types/auth-profile.types'

const EMPTY_RESOLUTION: EndgeFacetClaimResolution = Object.freeze({ selections: Object.freeze({}), issues: Object.freeze([]) })

// Проверяет опцию boot auth.facetClaims до первого использования, чтобы ошибка конфигурации host была явной.
export function normalizeFacetClaimMappings(
  input: Readonly<Record<string, EndgeFacetClaimMapping>> | null | undefined,
): Readonly<Record<string, Required<Pick<EndgeFacetClaimMapping, 'claim' | 'missing'>> & Pick<EndgeFacetClaimMapping, 'map'>>> {
  const result: Record<string, Required<Pick<EndgeFacetClaimMapping, 'claim' | 'missing'>> & Pick<EndgeFacetClaimMapping, 'map'>> = {}
  if (input == null) {
    return Object.freeze(result)
  }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('[EndgeAuth] auth.facetClaims must be an object of facet mappings')
  }
  for (const [rawFacet, mapping] of Object.entries(input)) {
    const facet = rawFacet.trim()
    const claim = typeof mapping?.claim === 'string' ? mapping.claim.trim() : ''
    if (!facet || !claim) {
      throw new TypeError(`[EndgeAuth] auth.facetClaims.${rawFacet} requires a non-empty facet and claim`)
    }
    const missing = mapping.missing ?? 'default'
    if (missing !== 'default' && missing !== 'error') {
      throw new TypeError(`[EndgeAuth] auth.facetClaims.${facet}.missing must be "default" or "error"`)
    }
    let map: Record<string, string> | undefined
    if (mapping.map != null) {
      if (typeof mapping.map !== 'object' || Array.isArray(mapping.map)) {
        throw new TypeError(`[EndgeAuth] auth.facetClaims.${facet}.map must be an object`)
      }
      map = {}
      for (const [value, document] of Object.entries(mapping.map)) {
        if (typeof document !== 'string' || !document.trim()) {
          throw new TypeError(`[EndgeAuth] auth.facetClaims.${facet}.map.${value} must be a document identity`)
        }
        map[value] = document.trim()
      }
      Object.freeze(map)
    }
    result[facet] = Object.freeze({ claim, missing, ...(map ? { map } : {}) })
  }
  return Object.freeze(result)
}

// Сопоставляет claims авторизованной session документам фасетов. Без session фасеты не фиксируются.
export function resolveFacetSelectionsFromClaims(
  mappings: ReturnType<typeof normalizeFacetClaimMappings>,
  claims: Readonly<Record<string, unknown>>,
  authenticated: boolean,
): EndgeFacetClaimResolution {
  const facets = Object.keys(mappings)
  if (!authenticated || facets.length === 0) {
    return EMPTY_RESOLUTION
  }
  const selections: Record<string, string> = {}
  const issues: EndgeFacetClaimIssue[] = []
  for (const facet of facets) {
    const mapping = mappings[facet]!
    const raw = readClaim(claims, mapping.claim)
    const candidates = (Array.isArray(raw) ? raw : [raw])
      .filter((value): value is string | number => (typeof value === 'string' && value.trim() !== '') || typeof value === 'number')
      .map(value => String(value).trim())
    if (raw != null && candidates.length === 0) {
      issues.push({ facet, claim: mapping.claim, reason: 'invalid', missing: mapping.missing })
      continue
    }
    if (candidates.length === 0) {
      issues.push({ facet, claim: mapping.claim, reason: 'missing', missing: mapping.missing })
      continue
    }
    const document = mapping.map
      ? candidates.map(value => mapping.map![value]).find(value => value != null)
      : candidates[0]
    if (!document) {
      issues.push({ facet, claim: mapping.claim, reason: 'unmapped', missing: mapping.missing })
      continue
    }
    selections[facet] = document
  }
  return { selections: Object.freeze(selections), issues: Object.freeze(issues) }
}

// Читает claim по JSON Pointer (RFC 6901) или по имени claim верхнего уровня.
export function readClaim(claims: Readonly<Record<string, unknown>>, claim: string): unknown {
  if (!claim.startsWith('/')) {
    return Object.hasOwn(claims, claim) ? claims[claim] : undefined
  }
  let cursor: unknown = claims
  for (const token of claim.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (cursor == null || typeof cursor !== 'object') {
      return undefined
    }
    if (Array.isArray(cursor)) {
      if (!/^(?:0|[1-9]\d*)$/.test(token)) {
        return undefined
      }
      cursor = cursor[Number(token)]
      continue
    }
    if (!Object.hasOwn(cursor, token)) {
      return undefined
    }
    cursor = (cursor as Record<string, unknown>)[token]
  }
  return cursor
}

// Человекочитаемое описание проблемы для diagnostics и ошибки boot.
export function describeFacetClaimIssue(issue: EndgeFacetClaimIssue): string {
  const reason = issue.reason === 'missing'
    ? 'is missing'
    : issue.reason === 'unmapped' ? 'has no mapped facet document' : 'is not a string'
  return `Facet "${issue.facet}" claim "${issue.claim}" ${reason} in the authenticated session`
}
