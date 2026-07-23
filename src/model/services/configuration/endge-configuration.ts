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
  DiagnosticsAdapterOptionValue,
  DiagnosticsFilter,
  DiagnosticsPhase,
  DiagnosticsSeverityNumber,
  DiagnosticsSignal,
  EndgeDiagnosticsConfiguration,
  EndgeDiagnosticsOutputConfiguration,
  EndgeDiagnosticsRoute,
} from '@/domain/types/diagnostics'
import { DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION } from '@/model/config/diagnostics'

const LEGACY_SFC_ADAPTER_IDS: Readonly<Record<string, string>> = {
  'shadcn-vue': 'native-vue',
  'vue-shadcn': 'native-vue',
}

const DEFAULT_LOCALE = 'en'
const DEFAULT_THEME = 'dark'

const DEFAULT_CONFIGURATION_VALUE: EndgeConfiguration = {
  vars: [],
  locales: [
    { code: 'ru', displayName: 'Русский', shortLabel: 'RU', direction: 'ltr' },
    { code: 'en', displayName: 'English', shortLabel: 'EN', direction: 'ltr' },
  ],
  defaultLocale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  themes: [
    { identity: 'light', displayName: 'Светлая' },
    { identity: 'dark', displayName: 'Тёмная' },
  ],
  defaultTheme: DEFAULT_THEME,
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
  const sfcAdapterIds = normalizeSfcAdapterIds(input.sfcAdapterIds)
  const localeCodes = locales.map(item => item.code)
  const defaultLocale = requireMember(
    normalizeText(input.defaultLocale) || DEFAULT_LOCALE,
    localeCodes,
    'defaultLocale',
  )
  const fallbackLocale = requireMember(
    normalizeText(input.fallbackLocale) || DEFAULT_LOCALE,
    localeCodes,
    'fallbackLocale',
  )
  const defaultTheme = requireMember(
    normalizeText(input.defaultTheme) || DEFAULT_THEME,
    themes.map(item => item.identity),
    'defaultTheme',
  )
  const defaultSfcAdapterId = requireMember(
    normalizeSfcAdapterId(input.defaultSfcAdapterId),
    sfcAdapterIds,
    'defaultSfcAdapterId',
  )

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

/** Migrates persisted adapter identifiers while exposing only canonical runtime ids. */
function normalizeSfcAdapterIds(input: unknown): string[] {
  return [...new Set(
    normalizeStringCollection(input, 'sfcAdapterIds').map(normalizeSfcAdapterId),
  )]
}

function normalizeSfcAdapterId(input: unknown): string {
  const id = String(input ?? '').trim()
  return LEGACY_SFC_ADAPTER_IDS[id] ?? id
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
  const legacyPatch = patch as typeof patch & {
    collection?: NonNullable<typeof patch.telemetry>['collection']
    routes?: NonNullable<typeof patch.telemetry>['routes']
  }
  const telemetry = patch.telemetry ?? {
    collection: legacyPatch.collection,
    routes: legacyPatch.routes,
  }
  const collection = telemetry.collection

  if (collection?.enabled?.op === 'set')
    next.telemetry.collection.enabled = collection.enabled.value
  if (collection?.enabled?.op === 'remove')
    throw new Error('[EndgeConfiguration] Required field "diagnostics.telemetry.collection.enabled" cannot be removed')

  if (collection?.signals)
    next.telemetry.collection.signals = applyCollectionPatch(next.telemetry.collection.signals, collection.signals, item => item)

  if (collection?.minSeverity?.op === 'set')
    next.telemetry.collection.minSeverity = collection.minSeverity.value
  if (collection?.minSeverity?.op === 'remove')
    throw new Error('[EndgeConfiguration] Required field "diagnostics.telemetry.collection.minSeverity" cannot be removed')

  if (collection?.maxRecords?.op === 'set')
    next.telemetry.collection.maxRecords = collection.maxRecords.value
  if (collection?.maxRecords?.op === 'remove')
    throw new Error('[EndgeConfiguration] Required field "diagnostics.telemetry.collection.maxRecords" cannot be removed')

  if (telemetry.outputs)
    next.telemetry.outputs = applyCollectionPatch(next.telemetry.outputs, telemetry.outputs, item => item.id)
  if (telemetry.routes)
    next.telemetry.routes = applyCollectionPatch(next.telemetry.routes, telemetry.routes, item => item.id)

  const snapshots = patch.snapshots
  applyDiagnosticsRequiredValue(next.snapshots.content, 'telemetry', snapshots?.content?.telemetry)
  applyDiagnosticsRequiredValue(next.snapshots.content, 'problems', snapshots?.content?.problems)
  applyDiagnosticsRequiredValue(next.snapshots.content, 'configuration', snapshots?.content?.configuration)
  applyDiagnosticsRequiredValue(next.snapshots.automatic, 'enabled', snapshots?.automatic?.enabled)
  applyDiagnosticsRequiredValue(next.snapshots.automatic, 'errorCount', snapshots?.automatic?.errorCount)
  applyDiagnosticsRequiredValue(next.snapshots.automatic, 'windowSeconds', snapshots?.automatic?.windowSeconds)
  applyDiagnosticsRequiredValue(next.snapshots.automatic, 'cooldownSeconds', snapshots?.automatic?.cooldownSeconds)
  if (snapshots?.automatic?.outputIds) {
    next.snapshots.automatic.outputIds = applyCollectionPatch(
      next.snapshots.automatic.outputIds,
      snapshots.automatic.outputIds,
      item => item,
    )
  }

  return normalizeDiagnosticsConfiguration(next)
}

/** Применяет required diagnostics override и запрещает remove для scalar policy. */
function applyDiagnosticsRequiredValue<TTarget extends object, TKey extends keyof TTarget>(
  target: TTarget,
  key: TKey,
  override: { op: 'set', value: TTarget[TKey] } | { op: 'remove' } | undefined,
): void {
  if (!override)
    return
  if (override.op === 'remove')
    throw new Error(`[EndgeConfiguration] Required field "diagnostics.${String(key)}" cannot be removed`)
  target[key] = override.value
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

  const rawTelemetry = isRecord(input.telemetry) ? input.telemetry : input
  const rawCollection = isRecord(rawTelemetry.collection) ? rawTelemetry.collection : {}
  const signals = normalizeDiagnosticsSignals(rawCollection.signals)
  const minSeverity = normalizeDiagnosticsSeverity(rawCollection.minSeverity, defaults.telemetry.collection.minSeverity)
  const maxRecords = normalizePositiveInteger(rawCollection.maxRecords, defaults.telemetry.collection.maxRecords)
  const rawSnapshots = isRecord(input.snapshots) ? input.snapshots : {}
  const rawContent = isRecord(rawSnapshots.content) ? rawSnapshots.content : {}
  const rawAutomatic = isRecord(rawSnapshots.automatic) ? rawSnapshots.automatic : {}

  return {
    telemetry: {
      collection: {
        enabled: typeof rawCollection.enabled === 'boolean' ? rawCollection.enabled : defaults.telemetry.collection.enabled,
        signals,
        minSeverity,
        maxRecords,
      },
      outputs: Array.isArray(rawTelemetry.outputs)
        ? normalizeDiagnosticsOutputs(rawTelemetry.outputs)
        : defaults.telemetry.outputs,
      routes: Array.isArray(rawTelemetry.routes)
        ? normalizeDiagnosticsRoutes(rawTelemetry.routes)
        : defaults.telemetry.routes,
    },
    snapshots: {
      content: {
        telemetry: normalizeBoolean(rawContent.telemetry, defaults.snapshots.content.telemetry),
        problems: normalizeBoolean(rawContent.problems, defaults.snapshots.content.problems),
        configuration: normalizeBoolean(rawContent.configuration, defaults.snapshots.content.configuration),
      },
      automatic: {
        enabled: normalizeBoolean(rawAutomatic.enabled, defaults.snapshots.automatic.enabled),
        errorCount: normalizePositiveInteger(rawAutomatic.errorCount, defaults.snapshots.automatic.errorCount),
        windowSeconds: normalizePositiveInteger(rawAutomatic.windowSeconds, defaults.snapshots.automatic.windowSeconds),
        cooldownSeconds: normalizeNonNegativeInteger(rawAutomatic.cooldownSeconds, defaults.snapshots.automatic.cooldownSeconds),
        outputIds: Array.isArray(rawAutomatic.outputIds)
          ? [...new Set(rawAutomatic.outputIds.map(normalizeText).filter(Boolean))]
          : defaults.snapshots.automatic.outputIds,
      },
    },
  }
}

/** Нормализует уникальный список поддерживаемых diagnostics signals. */
function normalizeDiagnosticsSignals(input: unknown): DiagnosticsSignal[] {
  const source = Array.isArray(input) ? input : DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION.telemetry.collection.signals
  return [...new Set(source.filter((item): item is DiagnosticsSignal => item === 'log' || item === 'span'))]
}

/** Нормализует базовый OpenTelemetry severity number. */
function normalizeDiagnosticsSeverity(input: unknown, fallback: DiagnosticsSeverityNumber): DiagnosticsSeverityNumber {
  const value = Number(input)
  return value === 1 || value === 5 || value === 9 || value === 13 || value === 17 || value === 21
    ? value
    : fallback
}

/** Нормализует outputs и сохраняет только JSON-safe adapter options. */
function normalizeDiagnosticsOutputs(input: unknown): EndgeDiagnosticsOutputConfiguration[] {
  const outputs: EndgeDiagnosticsOutputConfiguration[] = []
  const used = new Set<string>()

  for (const raw of Array.isArray(input) ? input : []) {
    if (!isRecord(raw))
      continue
    const id = normalizeText(raw.id)
    const adapterType = normalizeText(raw.adapterType)
    if (!id || !adapterType || used.has(id))
      continue

    used.add(id)
    outputs.push({
      id,
      name: normalizeText(raw.name) || id,
      enabled: raw.enabled !== false,
      adapterType,
      options: normalizeDiagnosticsAdapterOptions(raw.options),
    })
  }

  return outputs
}

/** Нормализует routes и поддерживает legacy target.adapterId при чтении. */
function normalizeDiagnosticsRoutes(input: unknown): EndgeDiagnosticsRoute[] {
  const routes: EndgeDiagnosticsRoute[] = []
  const used = new Set<string>()

  for (const raw of Array.isArray(input) ? input : []) {
    if (!isRecord(raw))
      continue

    const id = normalizeText(raw.id)
    const legacyTarget = isRecord(raw.target) ? raw.target : {}
    const outputId = normalizeText(raw.outputId ?? legacyTarget.adapterId)
    if (!id || !outputId || used.has(id))
      continue

    used.add(id)
    routes.push({
      id,
      name: normalizeText(raw.name) || id,
      enabled: raw.enabled !== false,
      match: normalizeDiagnosticsFilter(raw.match),
      outputId,
    })
  }

  return routes
}

/** Нормализует persisted route filter до поддерживаемого подмножества. */
function normalizeDiagnosticsFilter(input: unknown): DiagnosticsFilter {
  if (!isRecord(input))
    return {}

  const signals = Array.isArray(input.signals) ? normalizeDiagnosticsSignals(input.signals) : undefined
  const phases = normalizeDiagnosticsPhases(input.phases)
  const spanStatuses = normalizeDiagnosticsSpanStatuses(input.spanStatuses)
  const scopes = normalizeOptionalStringArray(input.scopes)
  const eventNames = normalizeOptionalStringArray(input.eventNames)
  const attributes = normalizeDiagnosticsAttributes(input.attributes)
  const minSeverity = input.minSeverity == null ? undefined : normalizeDiagnosticsSeverity(input.minSeverity, 1)

  return {
    ...(signals ? { signals } : {}),
    ...(phases ? { phases } : {}),
    ...(minSeverity ? { minSeverity } : {}),
    ...(spanStatuses ? { spanStatuses } : {}),
    ...(input.minDurationMs != null ? { minDurationMs: normalizeNonNegativeInteger(input.minDurationMs, 0) } : {}),
    ...(scopes ? { scopes } : {}),
    ...(eventNames ? { eventNames } : {}),
    ...(normalizeText(input.traceId) ? { traceId: normalizeText(input.traceId) } : {}),
    ...(normalizeText(input.spanId) ? { spanId: normalizeText(input.spanId) } : {}),
    ...(attributes ? { attributes } : {}),
  }
}

/** Нормализует optional список diagnostics phases. */
function normalizeDiagnosticsPhases(input: unknown): DiagnosticsPhase[] | undefined {
  if (!Array.isArray(input))
    return undefined
  const values = [...new Set(input.filter((item): item is DiagnosticsPhase => item === 'authoring' || item === 'build' || item === 'runtime'))]
  return values.length ? values : undefined
}

/** Нормализует optional список статусов завершённых spans. */
function normalizeDiagnosticsSpanStatuses(input: unknown): Array<'unset' | 'ok' | 'error'> | undefined {
  if (!Array.isArray(input))
    return undefined
  const values = [...new Set(input.filter((item): item is 'unset' | 'ok' | 'error' => item === 'unset' || item === 'ok' || item === 'error'))]
  return values.length ? values : undefined
}

/** Нормализует JSON-safe options без функций и undefined. */
function normalizeDiagnosticsAdapterOptions(input: unknown): Record<string, DiagnosticsAdapterOptionValue> {
  if (!isRecord(input))
    return {}
  const result: Record<string, DiagnosticsAdapterOptionValue> = {}
  for (const [key, value] of Object.entries(input)) {
    const normalized = normalizeDiagnosticsAdapterOptionValue(value)
    if (normalized !== undefined)
      result[key] = normalized
  }
  return result
}

/** Рекурсивно оставляет только JSON-safe adapter option value. */
function normalizeDiagnosticsAdapterOptionValue(input: unknown): DiagnosticsAdapterOptionValue | undefined {
  if (input === null || typeof input === 'string' || typeof input === 'boolean')
    return input
  if (typeof input === 'number')
    return Number.isFinite(input) ? input : undefined
  if (Array.isArray(input)) {
    const values = input.map(normalizeDiagnosticsAdapterOptionValue).filter((value): value is DiagnosticsAdapterOptionValue => value !== undefined)
    return values
  }
  if (isRecord(input))
    return normalizeDiagnosticsAdapterOptions(input)
  return undefined
}

/** Возвращает boolean или заданное default value. */
function normalizeBoolean(input: unknown, fallback: boolean): boolean {
  return typeof input === 'boolean' ? input : fallback
}

/** Нормализует обязательное положительное целое число. */
function normalizePositiveInteger(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

/** Нормализует целое число, допускающее нулевое значение. */
function normalizeNonNegativeInteger(input: unknown, fallback: number): number {
  const value = Number(input)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
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
