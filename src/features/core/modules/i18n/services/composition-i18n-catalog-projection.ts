import type { I18nCatalogProvenance, I18nRuntimeCatalog } from '@/features/core/modules/i18n/domain/i18n.types'
import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'

import { buildCompositionI18nCatalogs } from '@/features/core/modules/i18n/services/i18n-catalog'

export interface CompositionI18nCatalogProjectionOccurrence {
  id: string
  rootIdentity: string
  invocationPath: string[]
  catalogsByScope: Readonly<Record<string, I18nRuntimeCatalog>>
  provenanceByScope: Readonly<Record<string, I18nCatalogProvenance>>
}

export interface CompositionI18nCatalogProjectionInput {
  artifacts: RuntimeArtifactReader
  rootIdentities: readonly string[]
  targetIdentity: string
}

/**
 * Проецирует фактические каталоги i18n только из скомпилированных артефактов Composition.
 * RuntimeHost, lifecycle-хуки и пользовательский runtime source не выполняются.
 */
export function projectCompositionI18nCatalogs(
  input: CompositionI18nCatalogProjectionInput,
): CompositionI18nCatalogProjectionOccurrence[] {
  const targetIdentity = String(input.targetIdentity ?? '').trim()
  if (!targetIdentity) {
    return []
  }

  const occurrences: CompositionI18nCatalogProjectionOccurrence[] = []
  for (const rootIdentity of input.rootIdentities) {
    visitComposition({
      artifacts: input.artifacts,
      identity: rootIdentity,
      targetIdentity,
      rootIdentity,
      invocationPath: [],
      inherited: {},
      inheritedProvenance: {},
      ancestors: new Set(),
      occurrences,
    })
  }
  return occurrences
}

interface VisitCompositionInput {
  artifacts: RuntimeArtifactReader
  identity: string
  targetIdentity: string
  rootIdentity: string
  invocationPath: string[]
  inherited: I18nRuntimeCatalog
  inheritedProvenance: I18nCatalogProvenance
  ancestors: Set<string>
  occurrences: CompositionI18nCatalogProjectionOccurrence[]
}

function visitComposition(input: VisitCompositionInput): void {
  const identity = String(input.identity ?? '').trim()
  if (!identity || input.ancestors.has(identity)) {
    return
  }

  const artifact = input.artifacts.getArtifact<CompositionProgramPayload>('composition', identity)
  if (!artifact) {
    return
  }

  const catalogs = buildCompositionI18nCatalogs(artifact.payload, input.inherited)
  const provenance = buildCompositionI18nProvenance(artifact.payload, input.inheritedProvenance)
  if (identity === input.targetIdentity) {
    input.occurrences.push({
      id: [input.rootIdentity, ...input.invocationPath].join(' > '),
      rootIdentity: input.rootIdentity,
      invocationPath: [...input.invocationPath],
      catalogsByScope: Object.fromEntries(catalogs),
      provenanceByScope: Object.fromEntries(provenance),
    })
  }

  const ancestors = new Set(input.ancestors).add(identity)
  for (const runtime of artifact.payload.runtimes) {
    if (runtime.kind !== 'composition') {
      continue
    }

    visitComposition({
      ...input,
      identity: runtime.identity,
      invocationPath: [...input.invocationPath, runtime.path],
      inherited: catalogs.get(runtime.scopePath) ?? input.inherited,
      inheritedProvenance: provenance.get(runtime.scopePath) ?? input.inheritedProvenance,
      ancestors,
    })
  }
}

function buildCompositionI18nProvenance(
  payload: CompositionProgramPayload,
  inherited: I18nCatalogProvenance,
): Map<string, I18nCatalogProvenance> {
  const catalogs = new Map<string, I18nCatalogProvenance>()
  for (const scope of [...payload.scopes].sort((left, right) => left.sourceOrder - right.sourceOrder)) {
    const parent = scope.parentPath
      ? catalogs.get(scope.parentPath) ?? inherited
      : inherited
    const catalog = cloneProvenance(parent)
    const resources = (payload.i18nResources ?? [])
      .filter(resource => resource.scopePath === scope.path)
      .sort((left, right) => left.sourceOrder - right.sourceOrder)
    for (const resource of resources) {
      const locales = catalog[resource.name] ?? {}
      for (const [locale, messages] of Object.entries(resource.messages)) {
        const keys = { ...(locales[locale] ?? {}) }
        for (const key of Object.keys(messages)) {
          keys[key] = resource.identity
        }
        locales[locale] = keys
      }
      catalog[resource.name] = locales
    }
    catalogs.set(scope.path, catalog)
  }
  return catalogs
}

function cloneProvenance(provenance: I18nCatalogProvenance): I18nCatalogProvenance {
  return Object.fromEntries(Object.entries(provenance).map(([alias, locales]) => [
    alias,
    Object.fromEntries(Object.entries(locales).map(([locale, keys]) => [locale, { ...keys }])),
  ]))
}
