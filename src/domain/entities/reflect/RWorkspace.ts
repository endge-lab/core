import type {
  EndgeWorkspaceDefinition,
  EndgeWorkspaceDefinitionInput,
  EndgeWorkspaceLocale,
  EndgeWorkspaceSSEAuthMode,
  EndgeWorkspaceSSEConfig,
  EndgeWorkspaceTheme,
  EndgeWorkspaceVar,
} from '@/domain/types/document/workspace.types'

import { Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'

export class RWorkspace extends REntity implements EndgeWorkspaceDefinition {
  @Expose()
  displayName = ''

  @Expose()
  vars: EndgeWorkspaceVar[] = []

  @Expose()
  sse?: EndgeWorkspaceSSEConfig

  @Expose()
  locales: EndgeWorkspaceLocale[] = []

  @Expose()
  defaultLocale!: string

  @Expose()
  fallbackLocale!: string

  @Expose()
  themes: EndgeWorkspaceTheme[] = []

  @Expose()
  defaultTheme!: string

  @Expose()
  defaultAuthProfileIdentity: string | null = null

  @Expose()
  sfcAdapterIds: string[] = []

  @Expose()
  defaultSfcAdapterId!: string

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
      themes: this.themes.map(theme => ({ ...theme })),
      defaultTheme: this.defaultTheme,
      defaultAuthProfileIdentity: this.defaultAuthProfileIdentity,
      sfcAdapterIds: [...this.sfcAdapterIds],
      defaultSfcAdapterId: this.defaultSfcAdapterId,
    }
  }
}

export function normalizeEndgeWorkspaceDefinition(input: unknown): EndgeWorkspaceDefinition {
  return RWorkspace.fromPlain(input).toPlain()
}

function createWorkspace(input: unknown): RWorkspace {
  if (!isRecord(input))
    throw new Error('[RWorkspace] Payload workspace must be an object')

  const source = input as EndgeWorkspaceDefinitionInput
  const workspace = new RWorkspace()
  const identity = requireText(source.identity, 'identity')
  const displayName = requireText(source.displayName ?? source.name, 'displayName')

  workspace.id = normalizeNumericId(source.id)
  workspace.identity = identity
  workspace.name = displayName
  workspace.displayName = displayName
  workspace.vars = normalizeVars(source.vars)
  workspace.sse = normalizeSSE(source.sse ?? source.sse_endpoint ?? source.sseEndpoint)
  workspace.locales = normalizeLocales(source.locales)

  const defaultLocale = normalizeText(source.defaultLocale ?? source.default_locale, '')
  const fallbackLocale = normalizeText(source.fallbackLocale ?? source.fallback_locale, '')
  workspace.defaultLocale = requireSupportedLocale(defaultLocale, workspace.locales, 'defaultLocale')
  workspace.fallbackLocale = requireSupportedLocale(fallbackLocale, workspace.locales, 'fallbackLocale')
  workspace.themes = normalizeThemes(source.themes)
  workspace.defaultTheme = requireSupportedTheme(
    source.defaultTheme ?? source.default_theme,
    workspace.themes,
    'defaultTheme',
  )
  workspace.defaultAuthProfileIdentity = normalizeNullableText(
    source.defaultAuthProfileIdentity ?? source.default_auth_profile_identity,
  )
  workspace.sfcAdapterIds = normalizeSfcAdapterIds(source.sfcAdapterIds ?? source.sfc_adapter_ids)
  workspace.defaultSfcAdapterId = selectWorkspaceSfcAdapter(
    source.defaultSfcAdapterId ?? source.default_sfc_adapter_id,
    workspace.sfcAdapterIds,
  )

  return workspace
}

function normalizeThemes(value: unknown): EndgeWorkspaceTheme[] {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([identity, theme]) => isRecord(theme)
          ? { identity, ...theme }
          : { identity, displayName: theme })
      : []

  const result: EndgeWorkspaceTheme[] = []
  const used = new Set<string>()

  for (const raw of rawItems) {
    const source: Record<string, unknown> = isRecord(raw) ? raw : { identity: raw }
    const identity = normalizeText(source.identity ?? source.value ?? source.theme, '')
    if (!identity || used.has(identity))
      continue

    used.add(identity)
    result.push({
      identity,
      displayName: normalizeText(
        source.displayName ?? source.display_name ?? source.label ?? source.name,
        identity,
      ),
    })
  }

  if (!result.length)
    throw new Error('[RWorkspace] Payload field "themes" must contain at least one theme')

  return result
}

function normalizeSfcAdapterIds(value: unknown): string[] {
  const source = Array.isArray(value) ? value : []
  const result = Array.from(new Set(
    source
      .map(item => String(item ?? '').trim())
      .filter(Boolean),
  ))

  if (!result.length)
    throw new Error('[RWorkspace] Payload field "sfcAdapterIds" must contain at least one adapter id')

  return result
}

function selectWorkspaceSfcAdapter(value: unknown, adapterIds: string[]): string {
  const adapterId = String(value ?? '').trim()
  if (adapterIds.includes(adapterId))
    return adapterId

  throw new Error('[RWorkspace] Payload field "defaultSfcAdapterId" must reference an item from "sfcAdapterIds"')
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
      : []

  const result: EndgeWorkspaceLocale[] = []
  const used = new Set<string>()

  for (const raw of rawItems) {
    const locale = normalizeLocale(raw)
    if (!locale || used.has(locale.code))
      continue

    used.add(locale.code)
    result.push(locale)
  }

  if (!result.length)
    throw new Error('[RWorkspace] Payload field "locales" must contain at least one locale')

  return result
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

function requireSupportedLocale(
  value: string,
  locales: EndgeWorkspaceLocale[],
  field: string,
): string {
  if (value && locales.some(locale => locale.code === value))
    return value

  throw new Error(`[RWorkspace] Payload field "${field}" must reference an item from "locales"`)
}

function requireSupportedTheme(
  value: unknown,
  themes: EndgeWorkspaceTheme[],
  field: string,
): string {
  const identity = String(value ?? '').trim()
  if (identity && themes.some(theme => theme.identity === identity))
    return identity

  throw new Error(`[RWorkspace] Payload field "${field}" must reference an item from "themes"`)
}

function requireText(value: unknown, field: string): string {
  const text = String(value ?? '').trim()
  if (!text)
    throw new Error(`[RWorkspace] Payload field "${field}" is required`)
  return text
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
