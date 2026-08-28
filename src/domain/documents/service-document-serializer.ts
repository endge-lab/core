import type { DomainDocumentType } from '@/domain/types/document/document.types'

import { ComponentType, FilterType, QueryType } from '@/domain/types/document/document.types'

type RecordValue = Record<string, any>

/** Явные Domain lookup-зависимости чистой сериализации persisted-документа. */
export interface DocumentSerializationContext {
  resolveFolderIdentity: (value: string | number) => string | null
  resolveNavigationIdentity: (value: string | number) => string | null
  resolveEnvironmentIdentity: (value: string | number) => string | null
}

/** Преобразует persisted-модель Core в строгий write DTO service-backend. */
export function serializeServiceDocument(
  documentType: DomainDocumentType,
  source: unknown,
  context: DocumentSerializationContext,
): Record<string, unknown> {
  const model = asRecord(source)
  const plain = asRecord(typeof model.toPlain === 'function' ? model.toPlain() : source)
  const identity = text(model.identity ?? plain.identity ?? plain.id)
  const displayName = text(model.displayName ?? plain.displayName ?? model.name ?? plain.name ?? identity)
  const common: RecordValue = {
    identity,
    displayName,
    description: nullableText(model.description ?? plain.description),
    managedBy: text(model.managedBy ?? plain.managedBy) || 'user',
    managedById: nullableText(model.managedById ?? plain.managedById),
    meta: objectValue(model.meta ?? plain.meta),
    active: (model.active ?? plain.active) !== false,
  }
  const folderIdentity = resolveIdentity(model.folderId ?? plain.folderId ?? plain.folder, context.resolveFolderIdentity)
  if (folderIdentity) {
    common.folderIdentity = folderIdentity
  }

  const value = { ...plain, ...model }
  if (documentType === 'primitive' || documentType === 'type') {
    return withFields(common, value, ['isPrimitive', 'source', 'sourceVersion'], {
      isPrimitive: documentType === 'primitive' || value.isPrimitive === true,
      source: text(value.source),
      sourceVersion: positiveInteger(value.sourceVersion, 1),
    })
  }
  if (isQuery(documentType)) {
    return withFields(common, value, ['source', 'sourceVersion'], {
      source: text(value.source),
      sourceVersion: 2,
    })
  }
  if (documentType === 'data-view' || documentType === 'store' || documentType === 'stream' || documentType === 'style' || documentType === 'configuration') {
    return withFields(common, value, ['source', 'sourceVersion'], {
      source: text(value.source),
      sourceVersion: positiveInteger(value.sourceVersion, 1),
    })
  }
  if (documentType === 'composition') {
    return withFields(common, value, ['kind', 'kindIdentity', 'source', 'sourceVersion'], {
      kind: text(value.kind),
      kindIdentity: nullableText(value.kindIdentity),
      source: text(value.source),
      sourceVersion: positiveInteger(value.sourceVersion, 1),
    })
  }
  if (documentType === 'update') {
    return withFields(common, value, ['storeIdentity', 'source', 'sourceVersion'], {
      storeIdentity: text(value.storeIdentity),
      source: text(value.source),
      sourceVersion: positiveInteger(value.sourceVersion, 1),
    })
  }
  if (documentType === 'mock') {
    return withFields(common, value, ['contentSource', 'contentType', 'source', 'codeRef'], {
      contentSource: text(value.contentSource) || 'inline',
      contentType: text(value.contentType) || 'application/json',
      source: text(value.source),
      codeRef: nullableText(value.codeRef),
    })
  }
  if (documentType === ComponentType.SFC) {
    return withFields(common, value, ['source', 'tag', 'modelVersion', 'supportedTargets'], {
      source: text(value.source),
      tag: nullableText(value.tag),
      modelVersion: positiveInteger(value.modelVersion, 1),
      supportedTargets: stringArray(value.supportedTargets),
    })
  }
  if (documentType === 'action') {
    return withFields(common, value, ['definition', 'input', 'output', 'target', 'defaultImplementation', 'owner'])
  }
  if (documentType === FilterType.DefaultFilter) {
    return withFields(common, value, ['fields', 'source', 'sourceVersion'], {
      fields: arrayValue(value.fields),
      source: text(value.source),
      sourceVersion: positiveInteger(value.sourceVersion, 1),
    })
  }
  if (documentType === 'converter') {
    return common
  }
  if (documentType === 'computation') {
    return withFields(common, value, ['source', 'sourceVersion', 'contractVersion'], {
      source: text(value.source),
      sourceVersion: positiveInteger(value.sourceVersion, 1),
      contractVersion: positiveInteger(value.contractVersion, 1),
    })
  }
  if (documentType === 'vocabs') {
    return withFields(common, value, ['source', 'sourceVersion', 'mode', 'baseApiUrl', 'collectionSlug', 'authMode', 'authProfileIdentity'], {
      source: text(value.source),
      sourceVersion: positiveInteger(value.sourceVersion, 1),
    })
  }
  if (documentType === 'i18n-bundles') {
    return withFields(common, value, ['locales'], { locales: objectValue(value.locales) })
  }
  if (documentType === 'auth-profile') {
    return withFields(common, value, ['adapterId', 'config', 'credentials', 'session'], {
      config: objectValue(value.config),
      credentials: objectValue(value.credentials),
      session: value.session ? objectValue(value.session) : null,
    })
  }
  if (documentType === 'navigation') {
    return withFields(common, value, ['tree'], { tree: arrayValue(value.tree) })
  }
  if (documentType === 'environment') {
    return withFields(common, value, ['configuration'], { configuration: objectValue(value.configuration) })
  }
  if (documentType === 'tenant') {
    return withFields(common, value, ['code', 'configuration'], {
      code: text(value.code) || identity,
      configuration: objectValue(value.configuration),
    })
  }
  if (documentType === 'project') {
    return withFields(common, value, ['configuration', 'slug', 'order'], {
      configuration: objectValue(value.configuration),
      slug: nullableText(value.slug),
      order: nullableNumber(value.order),
      navigationIdentity: resolveNullableIdentity(value.navigationIdentity ?? value.navigationId, context.resolveNavigationIdentity),
      allowedEnvironments: resolveIdentities(value.allowedEnvironmentIdentities ?? value.allowedEnvironmentIds ?? value.allowedEnvironments, context.resolveEnvironmentIdentity),
    })
  }

  return common
}

/** Преобразует RFolder в write DTO service-backend. */
export function serializeServiceFolder(
  source: unknown,
  context: Pick<DocumentSerializationContext, 'resolveFolderIdentity'>,
): Record<string, unknown> {
  const model = asRecord(source)
  const plain = asRecord(typeof model.toPlain === 'function' ? model.toPlain() : source)
  const identity = text(model.identity ?? plain.identity ?? plain.id)
  const parentIdentity = resolveIdentity(model.parent ?? plain.parent, context.resolveFolderIdentity)
  return {
    identity,
    displayName: text(model.displayName ?? plain.displayName ?? model.name ?? plain.name ?? identity),
    description: nullableText(model.description ?? plain.description),
    entityType: text(model.entityType ?? plain.entityType),
    parentIdentity: parentIdentity || null,
    managedBy: text(model.managedBy ?? plain.managedBy) || 'user',
    managedById: nullableText(model.managedById ?? plain.managedById),
    meta: objectValue(model.meta ?? plain.meta),
    active: (model.active ?? plain.active) !== false,
  }
}

function withFields(
  common: RecordValue,
  source: RecordValue,
  fields: string[],
  overrides: RecordValue = {},
): Record<string, unknown> {
  const result = { ...common }
  for (const field of fields) {
    if (Object.hasOwn(source, field)) {
      result[field] = source[field]
    }
  }
  return { ...result, ...overrides }
}

function resolveIdentity(
  value: unknown,
  resolver: (value: string | number) => string | null,
): string {
  if (value == null || value === '') {
    return ''
  }
  return text(resolver(value as string | number) ?? value)
}

function resolveNullableIdentity(
  value: unknown,
  resolver: (value: string | number) => string | null,
): string | null {
  if (value == null || value === '') {
    return null
  }
  return nullableText(resolver(value as string | number) ?? value)
}

function resolveIdentities(
  value: unknown,
  resolver: (value: string | number) => string | null,
): string[] {
  return arrayValue(value).flatMap((item) => {
    const identity = text(resolver(item as string | number) ?? item)
    return identity ? [identity] : []
  })
}

function isQuery(value: DomainDocumentType): boolean {
  return value === QueryType.REST || value === QueryType.GraphQL || value === QueryType.Custom
}

function asRecord(value: unknown): RecordValue {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {}
}

function objectValue(value: unknown): Record<string, unknown> {
  return { ...asRecord(value) }
}

function arrayValue(value: unknown): any[] {
  return Array.isArray(value) ? [...value] : []
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).map(text).filter(Boolean)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function nullableText(value: unknown): string | null {
  const result = text(value)
  return result || null
}

function nullableNumber(value: unknown): number | null {
  const result = Number(value)
  return Number.isFinite(result) ? result : null
}

function positiveInteger(value: unknown, fallback: number): number {
  const result = Number(value)
  return Number.isInteger(result) && result > 0 ? result : fallback
}
