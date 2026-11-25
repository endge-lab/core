import type { BundleDelivery, DeliveryModule } from '../types/endge-bundle.types'
import type { RComponentSFC_IR_Node } from '@/features/core/modules/domain/types/component/sfc/ir.types'
import type { ExecutionBundle } from '@/features/core/modules/program/domain/types/execution-bundle.types'
import type { ComponentSFCProgramPayload, ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { ModuleReference } from '@/features/core/modules/runtime/module/module-reference'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import { readExecutionBundle } from '@/features/core/modules/program/tools/execution-bundle'
import { selectStartupBundle } from '@/features/core/modules/program/tools/startup-bundle'
import { moduleReferenceKey } from '@/features/core/modules/runtime/module/module-artifact'
import { isModuleReference } from '@/features/core/modules/runtime/module/module-reference'
import { bundleObject } from './bundle-json'
import { validateDeliveryDocuments } from './delivery-domain'

export function selectDeliveryRenderers(bundle: ExecutionBundle): ExecutionBundle['context']['configuration']['defaultRenderers'] {
  const renderers = bundle.context.configuration.defaultRenderers
  if (!renderers) {
    return undefined
  }
  const tags = new Set<string>()
  const pending: ProgramArtifact[] = [...Object.values(bundle.artifacts)]
  while (pending.length > 0) {
    const artifact = pending.pop()!
    pending.push(...artifact.children ?? [])
    if (artifact.ref.entityType === 'component-sfc') {
      const payload = artifact.payload as ComponentSFCProgramPayload
      const nodes: RComponentSFC_IR_Node[] = [...payload.ir?.template.roots ?? []]
      while (nodes.length > 0) {
        const node = nodes.pop()!
        if (node.kind === 'element') {
          tags.add(node.tag)
          nodes.push(...node.children)
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(renderers).filter(([tag]) => tags.has(tag)))
}

export function collectDeliveryModules(bundle: ExecutionBundle): ModuleReference[] {
  const references = new Map<string, ModuleReference>()
  const add = ({ identity, version }: ModuleReference) => {
    if (!isModuleReference(identity, version)) {
      throw new Error('[Bundle] Invalid module reference')
    }
    references.set(moduleReferenceKey({ identity, version }), { identity, version })
  }
  for (const reference of Object.values(bundle.context.configuration.defaultRenderers ?? {})) {
    add(reference)
  }
  for (const reference of bundle.context.configuration.timelinePresets ?? []) {
    add(reference)
  }
  for (const artifact of Object.values(bundle.artifacts)) {
    if (artifact.ref.entityType === 'composition') {
      for (const resource of (artifact.payload as unknown as CompositionProgramPayload).resources) {
        if (resource.kind === 'module') {
          add(resource)
        }
      }
    }
  }
  return [...references.values()]
}

function facetKey(facets: Readonly<Record<string, string>>): string {
  return JSON.stringify(Object.entries(facets).sort(([left], [right]) => left.localeCompare(right)))
}

export function readBundleDelivery(bundle: ExecutionBundle, input: unknown): BundleDelivery {
  const { variants, modules } = bundleObject(input, 'delivery')
  if (!Array.isArray(variants) || (modules !== undefined && !Array.isArray(modules))) {
    throw new Error('[Bundle] Invalid delivery')
  }
  const alternatives = variants.map(readExecutionBundle)
  const expected = new Set<string>()
  const keys = new Set<string>()
  for (const variant of [bundle, ...alternatives]) {
    validateDeliveryDocuments(variant)
    const key = facetKey(variant.context.facets ?? {})
    if (variant.exportScope !== 'startup-composition' || !variant.catalog.workspace?.startupCompositionIdentity
      || variant.catalog.workspace.identity !== bundle.catalog.workspace?.identity
      || variant.context.workspace !== variant.catalog.workspace.identity
      || variant.context.facets?.tenant !== bundle.context.facets?.tenant
      || Object.keys(variant.context.facets).sort().join('\n') !== Object.keys(bundle.context.facets).sort().join('\n')
      || keys.has(key)) {
      throw new Error('[Bundle] Invalid or duplicate delivery context')
    }
    const projected = selectStartupBundle(variant, variant.programId)
    if (Object.keys(projected.artifacts).length !== Object.keys(variant.artifacts).length
      || Object.keys(projected.catalog.documents).length !== Object.keys(variant.catalog.documents).length
      || Object.keys(variant.catalog.folders).length !== 0) {
      throw new Error('[Bundle] Unreachable documents or artifacts in delivery')
    }
    keys.add(key)
    for (const reference of collectDeliveryModules(variant)) {
      expected.add(moduleReferenceKey(reference))
    }
  }
  if (!modules) {
    return { variants: alternatives }
  }
  const assets: DeliveryModule[] = modules.map((entry) => {
    const { manifest, js, css } = bundleObject(entry, 'delivery module')
    const descriptor = bundleObject(manifest, 'module manifest')
    const { identity, version, formatVersion, hostApi } = descriptor
    if (typeof identity !== 'string' || typeof version !== 'string'
      || !isModuleReference(identity, version) || formatVersion !== 1 || hostApi !== 1
      || typeof js !== 'string' || js.length === 0 || (css !== undefined && typeof css !== 'string')
      || !expected.delete(moduleReferenceKey({ identity, version }))) {
      throw new Error('[Bundle] Invalid, duplicate or unrelated delivery module')
    }
    return { manifest: { identity, version, formatVersion, hostApi }, js, ...(css === undefined ? {} : { css }) }
  })
  if (expected.size) {
    throw new Error(`[Bundle] Missing delivery modules: ${[...expected].join(', ')}`)
  }
  return { variants: alternatives, modules: assets }
}

export function selectDeliveryProgram(bundle: ExecutionBundle, delivery: BundleDelivery, facets: Readonly<Record<string, string>>): ExecutionBundle {
  const selected = [bundle, ...delivery.variants].find(variant => facetKey(variant.context.facets ?? {}) === facetKey(facets))
  if (!selected) {
    throw new Error('[Bundle] No program for the requested facet selections')
  }
  return selected
}
