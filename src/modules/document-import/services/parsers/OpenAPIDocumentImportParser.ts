import type { DocumentImportDiagnostic } from '@/modules/document-import/domain/types/document-import.type'
import type { DocumentImportParser, DocumentImportParserResult } from '@/modules/document-import/services/parsers/DocumentImportParser'
import type { TypeSourceExpression, TypeSourceField } from '@/modules/source/domain/types/type-source.types'

import { parseDocument } from 'yaml'

import { serializeTypeSourceDocument } from '@/modules/source/services/type-source-serialize'

/** Преобразует OpenAPI YAML/JSON components.schemas в черновики Type Source. */
export class OpenAPIDocumentImportParser implements DocumentImportParser {
  public readonly format = 'openapi' as const

  /** Возвращает object schemas и диагностики неподдержанных OpenAPI constructs. */
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

    for (const [identity, schemaValue] of Object.entries(schemas)) {
      if (!isRecord(schemaValue)) {
        result.skipped.push({ kind: 'openapi-schema', identity, reason: 'Schema is not an object.' })
        continue
      }
      if (schemaValue.$ref || schemaValue.allOf || schemaValue.oneOf || schemaValue.anyOf) {
        result.skipped.push({
          kind: 'openapi-schema-composition',
          identity,
          reason: 'Top-level $ref, allOf, oneOf and anyOf schemas are not supported yet.',
        })
        continue
      }
      if (schemaValue.type !== 'object' && !isRecord(schemaValue.properties)) {
        result.skipped.push({
          kind: 'openapi-schema',
          identity,
          reason: `Schema type "${String(schemaValue.type ?? 'unknown')}" is not mapped to an Endge Type.`,
        })
        continue
      }

      const required = new Set(Array.isArray(schemaValue.required)
        ? schemaValue.required.filter((value): value is string => typeof value === 'string')
        : [])
      const properties = isRecord(schemaValue.properties) ? schemaValue.properties : {}
      const diagnostics: DocumentImportDiagnostic[] = []
      const fields: TypeSourceField[] = Object.entries(properties).map(([key, property]) => {
        const propertySchema = isRecord(property) ? property : {}
        const array = propertySchema.type === 'array'
        const valueSchema = array && isRecord(propertySchema.items) ? propertySchema.items : propertySchema
        if (valueSchema.allOf || valueSchema.oneOf || valueSchema.anyOf) {
          diagnostics.push({
            severity: 'warning',
            code: 'document-import-openapi-property-composition',
            message: `Property "${key}" uses an unsupported schema composition and was mapped to Any.`,
            candidateId: `type:${identity}`,
          })
        }
        return {
          key,
          type: resolveOpenAPIExpression(valueSchema),
          optional: !required.has(key),
          array,
          description: typeof propertySchema.description === 'string' ? propertySchema.description : undefined,
          min: typeof valueSchema.minimum === 'number' ? valueSchema.minimum : undefined,
          max: typeof valueSchema.maximum === 'number' ? valueSchema.maximum : undefined,
          examples: propertySchema.example === undefined ? [] : [propertySchema.example],
        }
      })

      result.candidates.push({
        id: `type:${identity}`,
        identity,
        displayName: typeof schemaValue.title === 'string' ? schemaValue.title : identity,
        description: typeof schemaValue.description === 'string' ? schemaValue.description : undefined,
        source: serializeTypeSourceDocument({ definition: { kind: 'object', fields } }),
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

function resolveOpenAPIExpression(schema: Record<string, unknown>): TypeSourceExpression {
  if (schema.allOf || schema.oneOf || schema.anyOf) {
    return { kind: 'reference', identity: 'Any' }
  }
  if (typeof schema.$ref === 'string') {
    return { kind: 'reference', identity: resolveOpenAPIType(schema) }
  }
  if (schema.type === 'object' || isRecord(schema.properties)) {
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
        return {
          key,
          type: resolveOpenAPIExpression(valueSchema),
          optional: !required.has(key),
          array,
          description: typeof propertySchema.description === 'string' ? propertySchema.description : undefined,
          examples: propertySchema.example === undefined ? [] : [propertySchema.example],
        }
      }),
    }
  }
  return { kind: 'reference', identity: resolveOpenAPIType(schema) }
}

function resolveOpenAPIType(schema: Record<string, unknown>): string {
  if (typeof schema.$ref === 'string') {
    const match = schema.$ref.match(/#\/components\/schemas\/(.+)$/)
    if (!match?.[1]) {
      return 'Unknown'
    }
    const identity = match[1].replaceAll('~1', '/').replaceAll('~0', '~')
    return identity === 'UUID' ? 'ID' : identity
  }
  if (schema.type === 'integer' || schema.type === 'number') {
    return 'Number'
  }
  if (schema.type === 'string') {
    return schema.format === 'uuid' ? 'ID' : 'String'
  }
  if (schema.type === 'boolean') {
    return 'Boolean'
  }
  if (schema.type === 'null') {
    return 'Null'
  }
  return 'Any'
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
