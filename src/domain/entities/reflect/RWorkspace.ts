import type {
  EndgeWorkspaceDefinition,
  EndgeWorkspaceDefinitionInput,
  EndgeWorkspaceLocale,
} from '@/domain/types/workspace.types'

import { Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'
import { DEFAULT_ENDGE_WORKSPACE } from '@/model/config/endge-workspace'

export class RWorkspace extends REntity implements EndgeWorkspaceDefinition {
  @Expose()
  displayName: string = DEFAULT_ENDGE_WORKSPACE.displayName

  @Expose()
  locales: EndgeWorkspaceLocale[] = [...DEFAULT_ENDGE_WORKSPACE.locales]

  @Expose()
  defaultLocale: string = DEFAULT_ENDGE_WORKSPACE.defaultLocale

  @Expose()
  fallbackLocale: string = DEFAULT_ENDGE_WORKSPACE.fallbackLocale

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
      locales: this.locales.map(locale => ({ ...locale })),
      defaultLocale: this.defaultLocale,
      fallbackLocale: this.fallbackLocale,
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
  workspace.locales = normalizeLocales(source.locales)

  const defaultLocale = normalizeText(source.defaultLocale ?? source.default_locale, '')
  const fallbackLocale = normalizeText(source.fallbackLocale ?? source.fallback_locale, '')
  workspace.defaultLocale = selectSupportedLocale(defaultLocale, workspace.locales, DEFAULT_ENDGE_WORKSPACE.defaultLocale)
  workspace.fallbackLocale = selectSupportedLocale(fallbackLocale, workspace.locales, workspace.defaultLocale)

  return workspace
}

function normalizeLocales(value: unknown): EndgeWorkspaceLocale[] {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.entries(value).map(([code, locale]) => isRecord(locale) ? { code, ...locale } : { code, label: locale })
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
  const code = normalizeText(source.code ?? source.value ?? source.locale, '')
  if (!code)
    return null

  const upper = code.toUpperCase()
  const label = normalizeText(source.label ?? source.name, upper)
  const nativeLabel = normalizeText(source.nativeLabel ?? source.native_label ?? source.nativeName, label)
  const shortLabel = normalizeText(source.shortLabel ?? source.short_label, upper)
  const direction = source.direction === 'rtl' ? 'rtl' : source.direction === 'ltr' ? 'ltr' : undefined

  return {
    code,
    label,
    nativeLabel,
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

function normalizeNumericId(value: unknown): number {
  const id = Number(value)
  return Number.isFinite(id) ? id : 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
