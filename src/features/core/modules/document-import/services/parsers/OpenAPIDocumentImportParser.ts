import type { DocumentImportDiagnostic } from '@/features/core/modules/document-import/domain/types/document-import.type'
import type { DocumentImportParser, DocumentImportParserResult } from '@/features/core/modules/document-import/services/parsers/DocumentImportParser'
import type { TypeSourceExpression } from '@/features/core/modules/source/domain/types/type-source.types'

import { parseDocument } from 'yaml'

import { serializeTypeSourceDocument } from '@/features/core/modules/source/services/type-source-serialize'

/** Преобразует OpenAPI YAML/JSON components.schemas в черновики Type Source. */
export class OpenAPIDocumentImportParser implements DocumentImportParser {
  public readonly format = 'openapi' as const

  /** Возвращает object/enum schemas и диагностики неподдержанных OpenAPI constructs. */
  public parse(source: string): DocumentImportParserResult {
    const document = parseDocument(source, { prettyErrors: true })
    if (document.errors.length > 0) {
      return {
        candidates: [],
        diagnostics: document.errors.map(error => yamlDiagnostic(error)),
        skipped: [],
      }
    }

    const parsed = document.toJS()
    if (!isRecord(parsed)) {
      return invalidOpenAPI('OpenAPI document must contain an object at the root.')
    }
    const version = typeof parsed.openapi === 'string' ? parsed.openapi : ''
    if (!version.startsWith('3.')) {
      return invalidOpenAPI('Only OpenAPI 3.x documents are supported.')
    }

    const result: DocumentImportParserResult = {
      candidates: [],
      diagnostics: document.warnings.map(error => yamlDiagnostic(error, 'warning')),
      skipped: [],
    }
    const components = isRecord(parsed.components) ? parsed.components : null
    const schemas = components && isRecord(components.schemas) ? components.schemas : null
    if (!schemas) {
      result.diagnostics.push({
        severity: 'warning',
        code: 'document-import-openapi-schemas-missing',
        message: 'OpenAPI document does not contain components.schemas.',
      })
      return result
    }

    const primitiveAliases = collectOpenAPIPrimitiveAliases(schemas)

    for (const [identity, schemaValue] of Object.entries(schemas)) {
      if (!isRecord(schemaValue)) {
        result.skipped.push({ kind: 'openapi-schema', identity, reason: 'Schema is not an object.' })
        continue
      }
      if (primitiveAliases.has(identity)) {
        continue
      }
      if (schemaValue.allOf || schemaValue.oneOf || schemaValue.anyOf) {
        result.skipped.push({
          kind: 'openapi-schema-composition',
          identity,
          reason: 'Top-level allOf, oneOf and anyOf schemas are not supported yet.',
        })
        continue
      }

      const diagnostics: DocumentImportDiagnostic[] = []
      const enumValues = readOpenAPIEnum(schemaValue)
      const definition = enumValues
        ? { kind: 'enum' as const, values: enumValues }
        : schemaValue.type === 'object' || isRecord(schemaValue.properties)
          ? resolveOpenAPIObjectDefinition(schemaValue, primitiveAliases, identity, diagnostics)
          : null
      if (!definition) {
        result.skipped.push({
          kind: 'openapi-schema',
          identity,
          reason: `Schema type "${String(schemaValue.type ?? 'unknown')}" is not mapped to an Endge Type.`,
        })
        continue
      }

      const fields = definition.kind === 'object' ? definition.fields : []

      result.candidates.push({
        id: `type:${identity}`,
        identity,
        displayName: typeof schemaValue.title === 'string' ? schemaValue.title : identity,
        description: typeof schemaValue.description === 'string' ? schemaValue.description : undefined,
        source: serializeTypeSourceDocument({ definition }),
        fields: fields.length,
        requiredFields: fields.filter(field => !field.optional).length,
        diagnostics,
      })
    }

    if (isRecord(parsed.paths) && Object.keys(parsed.paths).length > 0) {
      result.skipped.push({
        kind: 'openapi-paths',
        reason: 'OpenAPI operations are not mapped to Endge Query documents yet.',
      })
    }
    return result
  }
}

function collectOpenAPIPrimitiveAliases(
  schemas: Record<string, unknown>,
): ReadonlyMap<string, string> {
  const aliases = new Map<string, string>()
  for (const [identity, value] of Object.entries(schemas)) {
    if (!isRecord(value) || readOpenAPIEnum(value) || value.allOf || value.oneOf || value.anyOf) {
      continue
    }
    const primitive = resolveOpenAPIPrimitiveType(value)
    if (primitive) {
      aliases.set(identity, primitive)
    }
  }
  return aliases
}

function resolveOpenAPIObjectDefinition(
  schema: Record<string, unknown>,
  primitiveAliases: ReadonlyMap<string, string>,
  candidateIdentity?: string,
  diagnostics?: DocumentImportDiagnostic[],
): Extract<TypeSourceExpression, { kind: 'object' }> {
  const required = new Set(Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : [])
  const properties = isRecord(schema.properties) ? schema.properties : {}
  return {
    kind: 'object',
    fields: Object.entries(properties).map(([key, property]) => {
      const propertySchema = isRecord(property) ? property : {}
      const array = propertySchema.type === 'array'
      const valueSchema = array && isRecord(propertySchema.items) ? propertySchema.items : propertySchema
      if (candidateIdentity && diagnostics && (valueSchema.allOf || valueSchema.oneOf || valueSchema.anyOf)) {
        diagnostics.push({
          severity: 'warning',
          code: 'document-import-openapi-property-composition',
          message: `Property "${key}" uses an unsupported schema composition and was mapped to Any.`,
          candidateId: `type:${candidateIdentity}`,
        })
      }
      return {
        key,
        type: resolveOpenAPIExpression(valueSchema, primitiveAliases),
        optional: !required.has(key),
        array,
        description: typeof propertySchema.description === 'string' ? propertySchema.description : undefined,
        min: typeof valueSchema.minimum === 'number' ? valueSchema.minimum : undefined,
        max: typeof valueSchema.maximum === 'number' ? valueSchema.maximum : undefined,
        examples: propertySchema.example === undefined ? [] : [propertySchema.example],
      }
    }),
  }
}

function resolveOpenAPIExpression(
  schema: Record<string, unknown>,
  primitiveAliases: ReadonlyMap<string, string>,
): TypeSourceExpression {
  if (schema.allOf || schema.oneOf || schema.anyOf) {
    return { kind: 'reference', identity: 'Any' }
  }
  if (typeof schema.$ref === 'string') {
    return { kind: 'reference', identity: resolveOpenAPIType(schema, primitiveAliases) }
  }
  const enumValues = readOpenAPIEnum(schema)
  if (enumValues) {
    return { kind: 'enum', values: enumValues }
  }
  if (schema.type === 'object' || isRecord(schema.properties)) {
    return resolveOpenAPIObjectDefinition(schema, primitiveAliases)
  }
  return { kind: 'reference', identity: resolveOpenAPIType(schema, primitiveAliases) }
}

function resolveOpenAPIType(
  schema: Record<string, unknown>,
  primitiveAliases: ReadonlyMap<string, string>,
): string {
  if (typeof schema.$ref === 'string') {
    const match = schema.$ref.match(/#\/components\/schemas\/(.+)$/)
    if (!match?.[1]) {
      return 'Unknown'
    }
    const identity = match[1].replaceAll('~1', '/').replaceAll('~0', '~')
    return primitiveAliases.get(identity) ?? (identity === 'UUID' ? 'ID' : identity)
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return 'Number'
  }
  if (schema.type === 'string') {
    if (schema.format === 'uuid') {
      return 'ID'
    }
    if (schema.format === 'date-time') {
      return 'DateTime'
    }
    if (schema.format === 'time') {
      return 'Time'
    }
    return 'String'
  }
  if (schema.type === 'boolean') {
    return 'Boolean'
  }
  if (schema.type === 'null') {
    return 'Null'
  }
  return 'Any'
}

function resolveOpenAPIPrimitiveType(schema: Record<string, unknown>): string | null {
  if (typeof schema.$ref === 'string' || schema.type === 'object' || isRecord(schema.properties)) {
    return null
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return 'Number'
  }
  if (schema.type === 'string') {
    return resolveOpenAPIType(schema, new Map())
  }
  if (schema.type === 'boolean') {
    return 'Boolean'
  }
  if (schema.type === 'null') {
    return 'Null'
  }
  return null
}

function readOpenAPIEnum(schema: Record<string, unknown>): Array<string | number | boolean> | null {
  if (!Array.isArray(schema.enum) || schema.enum.length === 0) {
    return null
  }
  const values = schema.enum.filter((value): value is string | number | boolean => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
  ))
  return values.length === schema.enum.length ? values : null
}

function yamlDiagnostic(error: unknown, severity: DocumentImportDiagnostic['severity'] = 'error'): DocumentImportDiagnostic {
  const value = error as { message?: unknown, linePos?: Array<{ line?: number, col?: number }> }
  const location = value.linePos?.[0]
  return {
    severity,
    code: 'document-import-openapi-syntax',
    message: typeof value.message === 'string' ? value.message : String(error),
    line: location?.line,
    column: location?.col,
  }
}

function invalidOpenAPI(message: string): DocumentImportParserResult {
  return {
    candidates: [],
    diagnostics: [{ severity: 'error', code: 'document-import-openapi-invalid', message }],
    skipped: [],
  }
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
