import type {
  EndgeCollectionPatch,
  EndgeConfiguration,
  EndgeConfigurationContribution,
  EndgeConfigurationPatch,
  EndgeLocaleDefinition,
  EndgeSSEAuthMode,
  EndgeSSEConfiguration,
  EndgeThemeDefinition,
  EndgeVariableDefinition,
} from '@/domain/types/configuration'
import type {
  DiagnosticsAttributes,
  DiagnosticsFilter,
  DiagnosticsSeverityNumber,
  DiagnosticsSignal,
  EndgeDiagnosticsConfiguration,
  EndgeDiagnosticsRoute,
} from '@/domain/types/diagnostics'
import { DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION } from '@/model/config/diagnostics'

const DEFAULT_CONFIGURATION_VALUE: EndgeConfiguration = {
  vars: [],
  locales: [
    { code: 'ru', displayName: 'Русский', shortLabel: 'RU', direction: 'ltr' },
    { code: 'en', displayName: 'English', shortLabel: 'EN', direction: 'ltr' },
  ],
  defaultLocale: 'ru',
  fallbackLocale: 'ru',
  themes: [
    { identity: 'light', displayName: 'Светлая' },
    { identity: 'dark', displayName: 'Тёмная' },
  ],
  defaultTheme: 'light',
  defaultAuthProfileIdentity: null,
  sfcAdapterIds: ['native-vue'],
  defaultSfcAdapterId: 'native-vue',
  diagnostics: structuredCloneSafe(DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION),
}

export const DEFAULT_ENDGE_CONFIGURATION: Readonly<EndgeConfiguration> = Object.freeze(DEFAULT_CONFIGURATION_VALUE)

/** Создаёт независимую полную конфигурацию с системными defaults. */
export function createDefaultEndgeConfiguration(): EndgeConfiguration {
  return cloneConfiguration(DEFAULT_ENDGE_CONFIGURATION)
}

/** Нормализует и строго проверяет полную persisted-конфигурацию. */
export function normalizeEndgeConfiguration(input: unknown): EndgeConfiguration {
  if (!isRecord(input))
    throw new Error('[EndgeConfiguration] configuration must be an object')

  const locales = normalizeLocales(input.locales)
  const themes = normalizeThemes(input.themes)
  const sfcAdapterIds = normalizeStringCollection(input.sfcAdapterIds, 'sfcAdapterIds')
  const defaultLocale = requireMember(input.defaultLocale, locales.map(item => item.code), 'defaultLocale')
  const fallbackLocale = requireMember(input.fallbackLocale, locales.map(item => item.code), 'fallbackLocale')
  const defaultTheme = requireMember(input.defaultTheme, themes.map(item => item.identity), 'defaultTheme')
  const defaultSfcAdapterId = requireMember(input.defaultSfcAdapterId, sfcAdapterIds, 'defaultSfcAdapterId')

  return {
    vars: normalizeVars(input.vars),
    ...(normalizeSSE(input.sse) ? { sse: normalizeSSE(input.sse) } : {}),
    locales,
    defaultLocale,
    fallbackLocale,
    themes,
    defaultTheme,
    defaultAuthProfileIdentity: normalizeNullableText(input.defaultAuthProfileIdentity),
    sfcAdapterIds,
    defaultSfcAdapterId,
    diagnostics: normalizeDiagnosticsConfiguration(input.diagnostics),
  }
}

/** Нормализует contribution сущности; пустое значение означает чистое наследование. */
export function normalizeEndgeConfigurationContribution(input: unknown): EndgeConfigurationContribution {
  if (!isRecord(input))
    return { mode: 'inherit', patch: {} }

  if (input.mode === 'replace') {
    return {
      mode: 'replace',
      value: normalizeEndgeConfiguration(input.value),
    }
  }

  return {
    mode: 'inherit',
    patch: normalizePatch(input.patch),
  }
}

/** Применяет один Project/Environment/Tenant contribution к upstream configuration. */
export function applyEndgeConfigurationContribution(
  upstream: EndgeConfiguration,
  contribution: EndgeConfigurationContribution,
): EndgeConfiguration {
  if (contribution.mode === 'replace')
    return cloneConfiguration(contribution.value)

  const next = cloneConfiguration(upstream)
  const patch = contribution.patch

  if (patch.vars)
    next.vars = applyCollectionPatch(next.vars, patch.vars, item => item.name)
  if (patch.locales)
    next.locales = applyCollectionPatch(next.locales, patch.locales, item => item.code)
  if (patch.themes)
    next.themes = applyCollectionPatch(next.themes, patch.themes, item => item.identity)
  if (patch.sfcAdapterIds)
    next.sfcAdapterIds = applyCollectionPatch(next.sfcAdapterIds, patch.sfcAdapterIds, item => item)
  if (patch.diagnostics)
    next.diagnostics = applyDiagnosticsPatch(next.diagnostics, patch.diagnostics)

  applyOptionalValue(next, 'sse', patch.sse)
  applyRequiredValue(next, 'defaultLocale', patch.defaultLocale)
  applyRequiredValue(next, 'fallbackLocale', patch.fallbackLocale)
  applyRequiredValue(next, 'defaultTheme', patch.defaultTheme)
  applyNullableValue(next, 'defaultAuthProfileIdentity', patch.defaultAuthProfileIdentity)
  applyRequiredValue(next, 'defaultSfcAdapterId', patch.defaultSfcAdapterId)

  return normalizeEndgeConfiguration(next)
}

/** Возвращает стабильный hash полного build context без platform crypto API. */
export function createEndgeContextHash(input: unknown): string {
  const source = stableStringify(input)
  let hash = 0x811C9DC5
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `ctx-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function normalizePatch(input: unknown): EndgeConfigurationPatch {
  if (!isRecord(input))
    return {}

  return structuredCloneSafe(input) as EndgeConfigurationPatch
}

/** Применяет diagnostics patch без замены остальных configuration fields. */
function applyDiagnosticsPatch(
  upstream: EndgeDiagnosticsConfiguration,
  patch: NonNullable<EndgeConfigurationPatch['diagnostics']>,
): EndgeDiagnosticsConfiguration {
  const next = structuredCloneSafe(upstream)
  const collection = patch.collection

  if (collection?.enabled?.op === 'set')
    next.collection.enabled = collection.enabled.value
  if (collection?.enabled?.op === 'remove')
    throw new Error('[EndgeConfiguration] Required field "diagnostics.collection.enabled" cannot be removed')

  if (collection?.signals)
    next.collection.signals = applyCollectionPatch(next.collection.signals, collection.signals, item => item)

  if (collection?.minSeverity?.op === 'set')
    next.collection.minSeverity = collection.minSeverity.value
  if (collection?.minSeverity?.op === 'remove')
    throw new Error('[EndgeConfiguration] Required field "diagnostics.collection.minSeverity" cannot be removed')

  if (collection?.maxRecords?.op === 'set')
    next.collection.maxRecords = collection.maxRecords.value
  if (collection?.maxRecords?.op === 'remove')
    throw new Error('[EndgeConfiguration] Required field "diagnostics.collection.maxRecords" cannot be removed')

  if (patch.routes)
    next.routes = applyCollectionPatch(next.routes, patch.routes, item => item.id)

  return normalizeDiagnosticsConfiguration(next)
}

function applyCollectionPatch<T>(
  upstream: T[],
  patch: EndgeCollectionPatch<T>,
  getKey: (item: T) => string,
): T[] {
  const result = new Map(upstream.map(item => [getKey(item), structuredCloneSafe(item)]))
  for (const entry of patch.entries ?? []) {
    const key = String(entry.key ?? '').trim()
    if (!key)
      continue
    if (entry.op === 'remove')
      result.delete(key)
    else if (entry.op === 'upsert')
      result.set(key, structuredCloneSafe(entry.value))
  }
  return [...result.values()]
}

function applyOptionalValue<K extends 'sse'>(
  target: EndgeConfiguration,
  key: K,
  override: EndgeConfigurationPatch[K],
): void {
  if (!override)
    return
  if (override.op === 'remove')
    delete target[key]
  else
    target[key] = structuredCloneSafe(override.value)
}

function applyRequiredValue<K extends 'defaultLocale' | 'fallbackLocale' | 'defaultTheme' | 'defaultSfcAdapterId'>(
  target: EndgeConfiguration,
  key: K,
  override: EndgeConfigurationPatch[K],
): void {
  if (!override)
    return
  if (override.op === 'remove')
    throw new Error(`[EndgeConfiguration] Required field "${key}" cannot be removed`)
  target[key] = override.value
}

function applyNullableValue<K extends 'defaultAuthProfileIdentity'>(
  target: EndgeConfiguration,
  key: K,
  override: EndgeConfigurationPatch[K],
): void {
  if (!override)
    return
  target[key] = override.op === 'remove' ? null : override.value
}

function cloneConfiguration(input: Readonly<EndgeConfiguration>): EndgeConfiguration {
  return structuredCloneSafe(input) as EndgeConfiguration
}

function normalizeVars(input: unknown): EndgeVariableDefinition[] {
  const result: EndgeVariableDefinition[] = []
  const used = new Set<string>()
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isRecord(raw))
      continue
    const name = normalizeText(raw.name)
    if (!name || used.has(name))
      continue
    used.add(name)
    result.push({ name, defaultValue: String(raw.defaultValue ?? '') })
  }
  return result
}

function normalizeLocales(input: unknown): EndgeLocaleDefinition[] {
  const result: EndgeLocaleDefinition[] = []
  const used = new Set<string>()
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isRecord(raw))
      continue
    const code = normalizeText(raw.code ?? raw.identity)
    if (!code || used.has(code))
      continue
    used.add(code)
    result.push({
      code,
      displayName: normalizeText(raw.displayName) || code,
      shortLabel: normalizeText(raw.shortLabel) || code.toUpperCase(),
      direction: raw.direction === 'rtl' ? 'rtl' : 'ltr',
    })
  }
  if (!result.length)
    throw new Error('[EndgeConfiguration] locales must contain at least one locale')
  return result
}

function normalizeThemes(input: unknown): EndgeThemeDefinition[] {
  const result: EndgeThemeDefinition[] = []
  const used = new Set<string>()
  for (const raw of Array.isArray(input) ? input : []) {
    if (!isRecord(raw))
      continue
    const identity = normalizeText(raw.identity)
    if (!identity || used.has(identity))
      continue
    used.add(identity)
    result.push({ identity, displayName: normalizeText(raw.displayName) || identity })
  }
  if (!result.length)
    throw new Error('[EndgeConfiguration] themes must contain at least one theme')
  return result
}

function normalizeStringCollection(input: unknown, field: string): string[] {
  const result = [...new Set((Array.isArray(input) ? input : []).map(normalizeText).filter(Boolean))]
  if (!result.length)
    throw new Error(`[EndgeConfiguration] ${field} must contain at least one item`)
  return result
}

function normalizeSSE(input: unknown): EndgeSSEConfiguration | undefined {
  if (!isRecord(input))
    return undefined
  const url = normalizeText(input.url)
  const authProfileIdentity = normalizeNullableText(input.authProfileIdentity)
  const manualToken = normalizeNullableText(input.manualToken)
  const authMode = normalizeSSEAuthMode(input.authMode)
  if (!url && !authProfileIdentity && !manualToken && authMode === 'inherit')
    return undefined
  return {
    url,
    authMode,
    ...(authProfileIdentity ? { authProfileIdentity } : {}),
    ...(manualToken ? { manualToken } : {}),
  }
}

function normalizeSSEAuthMode(input: unknown): EndgeSSEAuthMode {
  return input === 'profile' || input === 'manual' || input === 'none' ? input : 'inherit'
}

/** Нормализует полную diagnostics configuration и добавляет системные defaults. */
function normalizeDiagnosticsConfiguration(input: unknown): EndgeDiagnosticsConfiguration {
  const defaults = structuredCloneSafe(DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION)
  if (!isRecord(input))
    return defaults

  const rawCollection = isRecord(input.collection) ? input.collection : {}
  const signals = normalizeDiagnosticsSignals(rawCollection.signals)
  const minSeverity = normalizeDiagnosticsSeverity(rawCollection.minSeverity, defaults.collection.minSeverity)
  const maxRecords = Math.max(1, Math.floor(Number(rawCollection.maxRecords ?? defaults.collection.maxRecords) || defaults.collection.maxRecords))

  return {
    collection: {
      enabled: typeof rawCollection.enabled === 'boolean' ? rawCollection.enabled : defaults.collection.enabled,
      signals,
      minSeverity,
      maxRecords,
    },
    routes: normalizeDiagnosticsRoutes(input.routes),
  }
}

/** Нормализует уникальный список поддерживаемых diagnostics signals. */
function normalizeDiagnosticsSignals(input: unknown): DiagnosticsSignal[] {
  const source = Array.isArray(input) ? input : DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION.collection.signals
  return [...new Set(source.filter((item): item is DiagnosticsSignal => item === 'log' || item === 'span'))]
}

/** Нормализует базовый OpenTelemetry severity number. */
function normalizeDiagnosticsSeverity(input: unknown, fallback: DiagnosticsSeverityNumber): DiagnosticsSeverityNumber {
  const value = Number(input)
  return value === 1 || value === 5 || value === 9 || value === 13 || value === 17 || value === 21
    ? value
    : fallback
}

/** Нормализует routes и исключает записи без стабильного id или adapterId. */
function normalizeDiagnosticsRoutes(input: unknown): EndgeDiagnosticsRoute[] {
  const routes: EndgeDiagnosticsRoute[] = []
  const used = new Set<string>()

  for (const raw of Array.isArray(input) ? input : []) {
    if (!isRecord(raw) || !isRecord(raw.target))
      continue

    const id = normalizeText(raw.id)
    const adapterId = normalizeText(raw.target.adapterId)
    if (!id || !adapterId || used.has(id))
      continue

    used.add(id)
    const integrationId = normalizeText(raw.target.integrationId)
    routes.push({
      id,
      enabled: raw.enabled !== false,
      match: normalizeDiagnosticsFilter(raw.match),
      target: {
        adapterId,
        ...(integrationId ? { integrationId } : {}),
      },
    })
  }

  return routes
}

/** Нормализует persisted route filter до поддерживаемого подмножества. */
function normalizeDiagnosticsFilter(input: unknown): DiagnosticsFilter {
  if (!isRecord(input))
    return {}

  const signals = Array.isArray(input.signals) ? normalizeDiagnosticsSignals(input.signals) : undefined
  const scopes = normalizeOptionalStringArray(input.scopes)
  const eventNames = normalizeOptionalStringArray(input.eventNames)
  const attributes = normalizeDiagnosticsAttributes(input.attributes)
  const minSeverity = input.minSeverity == null ? undefined : normalizeDiagnosticsSeverity(input.minSeverity, 1)

  return {
    ...(signals ? { signals } : {}),
    ...(minSeverity ? { minSeverity } : {}),
    ...(scopes ? { scopes } : {}),
    ...(eventNames ? { eventNames } : {}),
    ...(normalizeText(input.traceId) ? { traceId: normalizeText(input.traceId) } : {}),
    ...(normalizeText(input.spanId) ? { spanId: normalizeText(input.spanId) } : {}),
    ...(attributes ? { attributes } : {}),
  }
}

/** Нормализует непустой список строк или возвращает undefined. */
function normalizeOptionalStringArray(input: unknown): string[] | undefined {
  if (!Array.isArray(input))
    return undefined
  const values = [...new Set(input.map(normalizeText).filter(Boolean))]
  return values.length > 0 ? values : undefined
}

/** Нормализует безопасные scalar/array attributes route. */
function normalizeDiagnosticsAttributes(input: unknown): DiagnosticsAttributes | undefined {
  if (!isRecord(input))
    return undefined

  const attributes: DiagnosticsAttributes = {}
  for (const [key, value] of Object.entries(input)) {
    const normalizedKey = normalizeText(key)
    if (!normalizedKey)
      continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
      attributes[normalizedKey] = value
    else if (Array.isArray(value) && value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean'))
      attributes[normalizedKey] = value as Array<string | number | boolean>
  }

  return Object.keys(attributes).length > 0 ? attributes : undefined
}

function requireMember(input: unknown, values: string[], field: string): string {
  const value = normalizeText(input)
  if (!value || !values.includes(value))
    throw new Error(`[EndgeConfiguration] ${field} must reference an available item`)
  return value
}

function normalizeNullableText(input: unknown): string | null {
  return normalizeText(input) || null
}

function normalizeText(input: unknown): string {
  return String(input ?? '').trim()
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input != null && typeof input === 'object' && !Array.isArray(input)
}

function structuredCloneSafe<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T
}

function stableStringify(input: unknown): string {
  if (Array.isArray(input))
    return `[${input.map(stableStringify).join(',')}]`
  if (isRecord(input))
    return `{${Object.keys(input).sort().map(key => `${JSON.stringify(key)}:${stableStringify(input[key])}`).join(',')}}`
  return JSON.stringify(input)
}
