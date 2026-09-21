import type {
  ExecutionBundle,
  PortableProgramArtifact,
} from '../domain/types/execution-bundle.types'
import type {
  ProgramArtifact,
  ProgramEntityType,
} from '../domain/types/program.types'
import {
  bundleObject,
  bundleText,
  copyBundleJson,
} from '@/features/core/kernel/tools/bundle-json'
import { normalizeEndgeConfiguration } from '@/features/core/modules/configuration/domain/endge-configuration'
import { validatePortableProgramPayload } from './portable-program-payload'

/** Поддержанные compiler payload families; новые виды требуют явного добавления в wire contract. */
const PAYLOAD_TYPES: readonly ProgramEntityType[] = [
  'type',
  'component-sfc',
  'computation',
  'action',
  'query',
  'vocab',
  'data-view',
  'store',
  'stream',
  'simulation',
  'update',
  'filter',
  'composition',
  'style',
  'configuration',
]

/** AST имеет отдельную boundary; executable payload сохраняется без compiler instances. */
export function packProgramArtifact(
  artifact: ProgramArtifact,
  includeAst: boolean,
): PortableProgramArtifact {
  if (!PAYLOAD_TYPES.includes(artifact.ref.entityType)) {
    throw new Error('[Bundle] Unsupported artifact type')
  }
  const payload = bundleObject(artifact.payload, 'artifact payload')
  const { ast, sourceParts: _sourceParts, ...executable } = payload
  const packed = copyBundleJson({
    ...artifact,
    payload: executable,
    children: undefined,
  }) as unknown as PortableProgramArtifact
  if (includeAst && ast != null) {
    const target = bundleObject(packed.payload, 'payload')
    target.ast = copyBundleJson(ast, true)
  }
  if (artifact.children) {
    packed.children = artifact.children.map(child =>
      packProgramArtifact(child, includeAst),
    )
  }
  return packed
}

/** Проверяет весь transport до изменения Program. Индексы строятся из validated refs. */
export function readExecutionBundle(input: unknown): ExecutionBundle {
  const value = bundleObject(copyBundleJson(input), 'program')
  if (value.version !== 1) {
    throw new Error('[Bundle] Unsupported program version')
  }
  bundleText(value.programId, 'programId')
  bundleText(value.compilerVersion, 'compilerVersion')
  if (
    typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new TypeError('[Bundle] Invalid creation time')
  }
  const context = bundleObject(value.context, 'context')
  normalizeEndgeConfiguration(context.configuration)
  const facets = bundleObject(context.facets, 'context facets')
  if (Object.values(facets).some(item => typeof item !== 'string')) {
    throw new Error('[Bundle] Invalid context facets')
  }
  for (const key of ['workspace', 'user', 'locale', 'theme', 'timezone']) {
    if (context[key] !== null && typeof context[key] !== 'string') {
      throw new Error('[Bundle] Invalid context field')
    }
  }
  const requirements = bundleObject(value.requirements, 'requirements')
  if (
    !Array.isArray(requirements.artifactTypes)
    || !Array.isArray(requirements.componentTags)
  ) {
    throw new TypeError('[Bundle] Invalid requirements')
  }
  if (
    requirements.artifactTypes.some(
      type => !PAYLOAD_TYPES.includes(type as ProgramEntityType),
    )
  ) {
    throw new Error('[Bundle] Unsupported artifact requirement')
  }
  const hostActions = new Set<string>()
  if (requirements.hostActions !== undefined) {
    if (!Array.isArray(requirements.hostActions)) {
      throw new TypeError('[Bundle] Invalid host action requirements')
    }
    for (const raw of requirements.hostActions) {
      const action = bundleObject(raw, 'host action')
      bundleText(action.identity, 'host action identity')
      bundleText(action.owner, 'host action owner')
      bundleText(action.providerKey, 'host action provider')
      if (hostActions.has(String(action.identity))) {
        throw new Error('[Bundle] Duplicate host action requirement')
      }
      hostActions.add(String(action.identity))
    }
  }
  const tags = new Set<string>()
  for (const raw of requirements.componentTags) {
    const tag = bundleObject(raw, 'component tag')
    bundleText(tag.tag, 'tag')
    bundleText(tag.identity, 'tag identity')
    if (tags.has(String(tag.tag))) {
      throw new Error('[Bundle] Duplicate component tag')
    }
    tags.add(String(tag.tag))
  }
  const catalog = bundleObject(value.catalog, 'catalog')
  if (catalog.workspace !== undefined) {
    const workspace = bundleObject(catalog.workspace, 'catalog workspace')
    bundleText(workspace.identity, 'workspace identity')
    bundleText(workspace.displayName, 'workspace displayName')
    if (workspace.identity !== context.workspace || (workspace.startupCompositionIdentity !== null && typeof workspace.startupCompositionIdentity !== 'string') || (workspace.documentStructure !== undefined && !['frontend', 'custom'].includes(String(workspace.documentStructure)))) {
      throw new Error('[Bundle] Invalid workspace descriptor')
    }
  }
  const folders = bundleObject(catalog.folders, 'folders')
  const documents = bundleObject(catalog.documents, 'documents')
  const artifacts = bundleObject(value.artifacts, 'artifacts')
  const identities = new Set<string>()
  const checkArtifact = (raw: unknown, key?: string): void => {
    const item = bundleObject(raw, 'artifact')
    const ref = bundleObject(item.ref, 'artifact ref')
    if (!PAYLOAD_TYPES.includes(ref.entityType as ProgramEntityType)) {
      throw new Error('[Bundle] Unsupported artifact type')
    }
    if (typeof ref.id !== 'string' && typeof ref.id !== 'number') {
      throw new TypeError('[Bundle] Invalid artifact id')
    }
    bundleText(ref.identity, 'artifact identity')
    if (key !== undefined && key !== `${ref.entityType}:${ref.id}`) {
      throw new Error('[Bundle] Artifact key mismatch')
    }
    if (key !== undefined) {
      const identity = `${ref.entityType}:${ref.identity}`
      if (identities.has(identity)) {
        throw new Error('[Bundle] Duplicate artifact identity')
      }
      identities.add(identity)
    }
    if (!['valid', 'warning'].includes(String(item.status))) {
      throw new Error('[Bundle] Artifact has compilation errors')
    }
    if (item.compilerVersion !== value.compilerVersion) {
      throw new Error('[Bundle] Mixed compiler versions')
    }
    bundleText(item.sourceHash, 'sourceHash')
    if (
      !Array.isArray(item.dependencies)
      || !Array.isArray(item.diagnostics)
      || !Array.isArray(item.capabilities)
    ) {
      throw new TypeError('[Bundle] Invalid artifact collections')
    }
    if (
      item.diagnostics.some(
        raw => bundleObject(raw, 'diagnostic').severity === 'error',
      )
    ) {
      throw new Error('[Bundle] Artifact has compilation errors')
    }
    for (const raw of item.dependencies) {
      const dependency = bundleObject(raw, 'dependency')
      bundleText(dependency.entityType, 'dependency type')
      if (
        typeof dependency.id !== 'string'
        && typeof dependency.id !== 'number'
      ) {
        throw new TypeError('[Bundle] Invalid dependency id')
      }
    }
    bundleObject(item.metadata, 'artifact metadata')
    validatePortableProgramPayload(
      ref.entityType as ProgramEntityType,
      item.payload,
    )
    if (item.children !== undefined) {
      if (!Array.isArray(item.children)) {
        throw new TypeError('[Bundle] Invalid child artifacts')
      }
      item.children.forEach(child => checkArtifact(child))
    }
  }
  Object.entries(artifacts).forEach(([key, item]) => checkArtifact(item, key))
  const all = Object.values(artifacts).flatMap(function flatten(raw): Record<
    string,
    unknown
  >[] {
    const artifact = bundleObject(raw, 'artifact')
    return [
      artifact,
      ...(Array.isArray(artifact.children)
        ? artifact.children.flatMap(flatten)
        : []),
    ]
  })
  for (const artifact of all) {
    const ref = bundleObject(artifact.ref, 'ref')
    if (!requirements.artifactTypes.includes(ref.entityType)) {
      throw new Error('[Bundle] Missing artifact requirement')
    }
    for (const raw of artifact.dependencies as unknown[]) {
      const dependency = bundleObject(raw, 'dependency')
      if (
        PAYLOAD_TYPES.includes(dependency.entityType as ProgramEntityType)
        && !(dependency.entityType === 'action' && hostActions.has(String(dependency.identity ?? dependency.id)))
        && !all.some((target) => {
          const candidate = bundleObject(target.ref, 'ref')
          return (
            candidate.entityType === dependency.entityType
            && (String(candidate.id) === String(dependency.id)
              || (dependency.identity
                && candidate.identity === dependency.identity))
          )
        })
      ) {
        throw new Error(`[Bundle] Missing artifact dependency: ${String(ref.entityType)}:${String(ref.identity)} → ${String(dependency.entityType)}:${String(dependency.identity ?? dependency.id)}`)
      }
    }
  }
  for (const raw of requirements.componentTags) {
    const tag = bundleObject(raw, 'tag')
    if (!identities.has(`component-sfc:${tag.identity}`)) {
      throw new Error('[Bundle] Missing component tag artifact')
    }
  }
  for (const [key, raw] of Object.entries(folders)) {
    const folder = bundleObject(raw, 'folder')
    if (
      folder.id !== key
      || typeof folder.displayName !== 'string'
      || !Number.isFinite(folder.position)
      || !['workspace', 'collection'].includes(String(folder.scope))
    ) {
      throw new Error('[Bundle] Invalid folder descriptor')
    }
    for (const field of ['icon', 'color']) {
      if (folder[field] !== undefined && typeof folder[field] !== 'string') {
        throw new Error('[Bundle] Invalid folder presentation')
      }
    }
    const visited = new Set<string>([key])
    let parent = folder.parentId
    while (parent !== null) {
      if (
        typeof parent !== 'string'
        || !Object.hasOwn(folders, parent)
        || visited.has(parent)
      ) {
        throw new Error('[Bundle] Invalid folder ancestry')
      }
      visited.add(parent)
      parent = bundleObject(folders[parent], 'parent folder').parentId
    }
  }
  for (const raw of Object.values(documents)) {
    const document = bundleObject(raw, 'document')
    for (const field of ['documentType', 'facetIdentity', 'kind', 'kindIdentity', 'storeIdentity', 'icon', 'color']) {
      if (document[field] !== undefined && typeof document[field] !== 'string') {
        throw new Error('[Bundle] Invalid document navigation')
      }
    }
    bundleText(document.identity, 'document identity')
    bundleText(document.id, 'document id')
    bundleText(document.entityType, 'document type')
    if (
      typeof document.displayName !== 'string'
      || !Number.isFinite(document.position)
      || !['compiled', 'not-compiled'].includes(String(document.status))
    ) {
      throw new Error('[Bundle] Invalid document descriptor')
    }
    if (
      !Array.isArray(document.artifactKeys)
      || document.artifactKeys.some(
        key => typeof key !== 'string' || !Object.hasOwn(artifacts, key),
      )
    ) {
      throw new Error('[Bundle] Missing document artifact')
    }
    const hasArtifacts = document.artifactKeys.length > 0
    if ((document.status === 'compiled') !== hasArtifacts) {
      throw new Error('[Bundle] Document status mismatch')
    }
    for (const key of document.artifactKeys) {
      const ref = bundleObject(
        bundleObject(artifacts[String(key)], 'artifact').ref,
        'ref',
      )
      if (
        ref.entityType !== document.entityType
        || ref.identity !== document.identity
      ) {
        throw new Error('[Bundle] Document artifact mismatch')
      }
    }
    for (const field of ['folderId', 'workspaceFolderId']) {
      if (
        document[field] !== null
        && !Object.hasOwn(folders, String(document[field]))
      ) {
        throw new Error('[Bundle] Missing document folder')
      }
    }
  }
  return value as unknown as ExecutionBundle
}
