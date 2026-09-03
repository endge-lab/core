import type { Node } from '@babel/types'
import type { I18nRuntimeCatalog } from '@/modules/i18n/domain/i18n.types'
import type { CompositionProgramPayload } from '@/modules/source/domain/types/composition-source.types'
import type {
  SourceDocumentReference,
  SourceLanguageContext,
  SourceLanguageI18nOccurrence,
  SourceLanguageInlineHint,
} from '@/modules/source/domain/types/source-engine.types'

import * as t from '@babel/types'

import { compileCompositionSource } from '@/modules/source/services/compilers/composition-source-compile'

interface TranslationLiteral {
  key: string
  range: { start: number, end: number }
}

interface TranslationResolution {
  occurrence: string
  value: string | null
}

/** Resolves translation inline hints from current source and projected catalogs. */
export function compositionSourceI18nHints(context: SourceLanguageContext): SourceLanguageInlineHint[] {
  const i18n = context.i18n
  if (!i18n?.occurrences.length) {
    return []
  }

  const compiled = compileCompositionSource(context.source)
  if (!compiled.ast) {
    return []
  }

  return collectTranslationLiterals(compiled.ast as Node).flatMap((literal) => {
    const scopePath = compiled.artifact
      ? resolveLiteralScopePath(compiled.artifact, literal.range)
      : null
    const resolutions = i18n.occurrences.flatMap(occurrence => resolveTranslations(
      occurrence,
      scopePath,
      literal.key,
      i18n.locale,
      i18n.fallbackLocale,
    ))
    return createInlineHint(literal, resolutions, i18n.locale)
  })
}

/** Resolves an `alias:key` literal to one physical i18n document when unambiguous. */
export function compositionSourceI18nReferenceAt(
  context: SourceLanguageContext,
): SourceDocumentReference | null {
  const i18n = context.i18n
  const offset = positionToOffset(context)
  if (!i18n?.occurrences.length || offset == null) {
    return null
  }

  const compiled = compileCompositionSource(context.source)
  if (!compiled.ast) {
    return null
  }

  const literal = collectTranslationLiterals(compiled.ast as Node)
    .filter(item => item.range.start <= offset && item.range.end >= offset)
    .sort((left, right) => rangeLength(left.range) - rangeLength(right.range))[0]
  if (!literal) {
    return null
  }

  const scopePath = compiled.artifact
    ? resolveLiteralScopePath(compiled.artifact, literal.range)
    : null
  const identities = new Set(i18n.occurrences.flatMap(occurrence =>
    resolveI18nIdentities(
      occurrence,
      scopePath,
      literal.key,
      i18n.locale,
      i18n.fallbackLocale,
    ),
  ))
  if (identities.size !== 1) {
    return null
  }

  return {
    target: 'i18n-bundles',
    identity: [...identities][0]!,
    range: literal.range,
  }
}

function collectTranslationLiterals(ast: Node): TranslationLiteral[] {
  const literals: TranslationLiteral[] = []
  visitNode(ast, (node) => {
    if (!t.isStringLiteral(node) || node.start == null || node.end == null) {
      return
    }
    const separator = node.value.indexOf(':')
    if (separator < 1 || separator >= node.value.length - 1) {
      return
    }
    literals.push({
      key: node.value,
      range: { start: node.start, end: node.end },
    })
  })
  return literals
}

function visitNode(node: Node, visit: (node: Node) => void): void {
  visit(node)
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isNode(item)) {
          visitNode(item, visit)
        }
      }
    }
    else if (isNode(child)) {
      visitNode(child, visit)
    }
  }
}

function isNode(value: unknown): value is Node {
  return Boolean(value && typeof value === 'object' && typeof (value as Node).type === 'string')
}

function resolveLiteralScopePath(
  payload: CompositionProgramPayload,
  range: { start: number, end: number },
): string {
  return payload.runtimes
    .filter((runtime) => {
      const runtimeRange = runtime.sourceLocations?.runtime
      return runtimeRange && runtimeRange.start <= range.start && runtimeRange.end >= range.end
    })
    .sort((left, right) => {
      const leftRange = left.sourceLocations!.runtime
      const rightRange = right.sourceLocations!.runtime
      return (leftRange.end - leftRange.start) - (rightRange.end - rightRange.start)
    })[0]
    ?.scopePath ?? 'scope_default'
}

function resolveTranslations(
  occurrence: SourceLanguageI18nOccurrence,
  scopePath: string | null,
  publicKey: string,
  locale: string,
  fallbackLocale: string,
): TranslationResolution[] {
  const separator = publicKey.indexOf(':')
  const alias = publicKey.slice(0, separator)
  const key = publicKey.slice(separator + 1)
  if (scopePath) {
    const catalog = occurrence.catalogsByScope[scopePath]
      ?? occurrence.catalogsByScope.scope_default
      ?? {}
    return [{
      occurrence: occurrence.id,
      value: resolveCatalogValue(catalog, alias, key, locale, fallbackLocale),
    }]
  }

  const catalogs = Object.entries(occurrence.catalogsByScope)
  return (catalogs.length ? catalogs : [['scope_default', {}] as const]).map(([path, catalog]) => ({
    occurrence: `${occurrence.id} · ${path}`,
    value: resolveCatalogValue(catalog, alias, key, locale, fallbackLocale),
  }))
}

function resolveCatalogValue(
  catalog: I18nRuntimeCatalog,
  alias: string,
  key: string,
  locale: string,
  fallbackLocale: string,
): string | null {
  return catalog[alias]?.messages[locale]?.[key]
    ?? catalog[alias]?.messages[fallbackLocale]?.[key]
    ?? null
}

function resolveI18nIdentities(
  occurrence: SourceLanguageI18nOccurrence,
  scopePath: string | null,
  publicKey: string,
  locale: string,
  fallbackLocale: string,
): string[] {
  const separator = publicKey.indexOf(':')
  const alias = publicKey.slice(0, separator)
  const key = publicKey.slice(separator + 1)
  if (scopePath) {
    const provenance = occurrence.provenanceByScope[scopePath]
      ?? occurrence.provenanceByScope.scope_default
      ?? {}
    const identity = provenance[alias]?.[locale]?.[key]
      ?? provenance[alias]?.[fallbackLocale]?.[key]
    return identity ? [identity] : []
  }
  return Object.values(occurrence.provenanceByScope).flatMap((provenance) => {
    const identity = provenance[alias]?.[locale]?.[key]
      ?? provenance[alias]?.[fallbackLocale]?.[key]
    return identity ? [identity] : []
  })
}

function createInlineHint(
  literal: TranslationLiteral,
  resolutions: TranslationResolution[],
  locale: string,
): SourceLanguageInlineHint[] {
  const values = new Set(resolutions.flatMap(item => item.value == null ? [] : [item.value]))
  if (!values.size) {
    return []
  }

  const missingCount = resolutions.filter(item => item.value == null).length
  if (values.size === 1 && missingCount === 0) {
    const value = [...values][0]!
    return [{
      kind: 'translation',
      status: 'resolved',
      text: normalizeInlineText(value),
      tooltip: `**${escapeMarkdown(literal.key)}**\n\n${escapeMarkdown(locale)} · ${resolutions.length} context(s)`,
      range: literal.range,
    }]
  }

  const ambiguousText = values.size === 1
    ? `${normalizeInlineText([...values][0]!)} (не во всех контекстах)`
    : `неоднозначно (${values.size})`

  const details = resolutions
    .map(item => `- ${escapeMarkdown(item.occurrence)}: ${item.value == null ? '_missing_' : escapeMarkdown(item.value)}`)
    .join('\n')
  return [{
    kind: 'translation',
    status: 'ambiguous',
    text: ambiguousText,
    tooltip: `**${escapeMarkdown(literal.key)}**\n\n${details}`,
    range: literal.range,
  }]
}

function normalizeInlineText(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim() || '""'
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized
}

function escapeMarkdown(value: string): string {
  return String(value).replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&')
}

function positionToOffset(context: SourceLanguageContext): number | null {
  if (!context.position) {
    return null
  }
  const lines = context.source.split('\n')
  const lineIndex = Math.max(0, Math.min(context.position.lineNumber - 1, lines.length - 1))
  let offset = 0
  for (let index = 0; index < lineIndex; index++) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  return offset + Math.max(0, context.position.column - 1)
}

function rangeLength(range: { start: number, end: number }): number {
  return range.end - range.start
}
