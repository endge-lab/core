import type {
  EndgeWorkspaceDefinition,
  EndgeWorkspaceDefinitionInput,
  EndgeWorkspaceLocale,
  EndgeWorkspaceSSEAuthMode,
  EndgeWorkspaceSSEConfig,
  EndgeWorkspaceVar,
} from '@/domain/types/workspace.types'

import { Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'
import { DEFAULT_ENDGE_WORKSPACE } from '@/model/config/endge-workspace'

export class RWorkspace extends REntity implements EndgeWorkspaceDefinition {
  @Expose()
  displayName: string = DEFAULT_ENDGE_WORKSPACE.displayName

  @Expose()
  vars: EndgeWorkspaceVar[] = []

  @Expose()
  sse?: EndgeWorkspaceSSEConfig

  @Expose()
  locales: EndgeWorkspaceLocale[] = [...DEFAULT_ENDGE_WORKSPACE.locales]

  @Expose()
  defaultLocale: string = DEFAULT_ENDGE_WORKSPACE.defaultLocale

  @Expose()
  fallbackLocale: string = DEFAULT_ENDGE_WORKSPACE.fallbackLocale

  @Expose()
  defaultAuthProfileIdentity: string | null = DEFAULT_ENDGE_WORKSPACE.defaultAuthProfileIdentity

  static fromPlain(input: unknown): RWorkspace {
    return createWorkspace(input)
  }

  static fromPayload(input: unknown): RWorkspace {
    return createWorkspace(input)
  }

  toPlain(): EndgeWorkspaceDefinition {
    return {
      identity: this.identity,
      displayName: this.displayName,
      vars: this.vars.map(item => ({ ...item })),
      sse: this.sse ? { ...this.sse } : undefined,
      locales: this.locales.map(locale => ({ ...locale })),
      defaultLocale: this.defaultLocale,
      fallbackLocale: this.fallbackLocale,
      defaultAuthProfileIdentity: this.defaultAuthProfileIdentity,
    }
  }
}

export function normalizeEndgeWorkspaceDefinition(input: unknown): EndgeWorkspaceDefinition {
  return RWorkspace.fromPlain(input).toPlain()
}

function createWorkspace(input: unknown): RWorkspace {
  const source = isRecord(input) ? input as EndgeWorkspaceDefinitionInput : {}
  const workspace = new RWorkspace()
  const identity = normalizeText(source.identity ?? source.id, DEFAULT_ENDGE_WORKSPACE.identity)

  workspace.id = normalizeNumericId(source.id)
  workspace.identity = identity
  workspace.name = normalizeText(source.name ?? source.displayName, DEFAULT_ENDGE_WORKSPACE.displayName)
  workspace.displayName = normalizeText(source.displayName ?? source.name, workspace.name)
  workspace.vars = normalizeVars(source.vars)
  workspace.sse = normalizeSSE(source.sse ?? source.sse_endpoint ?? source.sseEndpoint)
  workspace.locales = normalizeLocales(source.locales)

  const defaultLocale = normalizeText(source.defaultLocale ?? source.default_locale, '')
  const fallbackLocale = normalizeText(source.fallbackLocale ?? source.fallback_locale, '')
  workspace.defaultLocale = selectSupportedLocale(defaultLocale, workspace.locales, DEFAULT_ENDGE_WORKSPACE.defaultLocale)
  workspace.fallbackLocale = selectSupportedLocale(fallbackLocale, workspace.locales, workspace.defaultLocale)
  workspace.defaultAuthProfileIdentity = normalizeNullableText(
    source.defaultAuthProfileIdentity ?? source.default_auth_profile_identity,
  )

  return workspace
}

function normalizeVars(value: unknown): EndgeWorkspaceVar[] {
  const items = Array.isArray(value) ? value : []
  const used = new Set<string>()
  const result: EndgeWorkspaceVar[] = []

  for (const raw of items) {
    const source = isRecord(raw) ? raw : {}
    const name = normalizeText(source.name ?? source.identity ?? source.key, '')
    if (!name || used.has(name))
      continue
    used.add(name)
    result.push({
      name,
      defaultValue: String(source.defaultValue ?? source.default_value ?? source.currentValue ?? source.value ?? ''),
    })
  }

  return result
}

function normalizeSSE(value: unknown): EndgeWorkspaceSSEConfig | undefined {
  if (typeof value === 'string') {
    const url = value.trim()
    return url ? { url, authMode: 'inherit' } : undefined
  }

  if (!isRecord(value))
    return undefined

  const url = normalizeText(value.url ?? value.endpoint ?? value.sseEndpoint ?? value.sse_endpoint, '')
  const authMode = normalizeSSEAuthMode(value.authMode ?? value.auth_mode)
  const authProfileIdentity = normalizeNullableText(value.authProfileIdentity ?? value.auth_profile_identity)
  const manualToken = normalizeNullableText(value.manualToken ?? value.manual_token)

  if (!url && !authProfileIdentity && !manualToken && authMode === 'inherit')
    return undefined

  return {
    url,
    authMode,
    ...(authProfileIdentity ? { authProfileIdentity } : {}),
    ...(manualToken ? { manualToken } : {}),
  }
}

function normalizeSSEAuthMode(value: unknown): EndgeWorkspaceSSEAuthMode {
  const mode = String(value ?? '').trim()
  if (mode === 'profile' || mode === 'manual' || mode === 'none')
    return mode
  return 'inherit'
}

function normalizeLocales(value: unknown): EndgeWorkspaceLocale[] {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([code, locale]) => isRecord(locale) ? { code, ...locale } : { code, displayName: locale })
      : DEFAULT_ENDGE_WORKSPACE.locales

  const result: EndgeWorkspaceLocale[] = []
  const used = new Set<string>()

  for (const raw of rawItems) {
    const locale = normalizeLocale(raw)
    if (!locale || used.has(locale.code))
      continue

    used.add(locale.code)
    result.push(locale)
  }

  return result.length ? result : DEFAULT_ENDGE_WORKSPACE.locales.map(locale => ({ ...locale }))
}

function normalizeLocale(input: unknown): EndgeWorkspaceLocale | null {
  const source = isRecord(input) ? input : { code: input }
  const code = normalizeText(source.code ?? source.identity ?? source.value ?? source.locale, '')
  if (!code)
    return null

  const upper = code.toUpperCase()
  const displayName = normalizeText(
    source.displayName
    ?? source.display_name
    ?? source.nativeLabel
    ?? source.native_label
    ?? source.nativeName
    ?? source.label
    ?? source.name,
    upper,
  )
  const shortLabel = normalizeText(source.shortLabel ?? source.short_label, upper)
  const direction = source.direction === 'rtl' ? 'rtl' : source.direction === 'ltr' ? 'ltr' : undefined

  return {
    code,
    displayName,
    shortLabel,
    ...(direction ? { direction } : {}),
  }
}

function selectSupportedLocale(
  value: string,
  locales: EndgeWorkspaceLocale[],
  fallback: string,
): string {
  if (value && locales.some(locale => locale.code === value))
    return value

  if (fallback && locales.some(locale => locale.code === fallback))
    return fallback

  return locales[0]?.code ?? DEFAULT_ENDGE_WORKSPACE.defaultLocale
}

function normalizeText(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim()
  return text || fallback
}

function normalizeNullableText(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return text || null
}

function normalizeNumericId(value: unknown): number {
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
