import type { TypeSourceExpression, TypeSourceField } from '@/modules/source/domain/types/type-source.types'
import { parse as parseYaml } from 'yaml'
import { RType } from '@/modules/domain/entities/RType'
import { serializeTypeSourceDocument } from '@/modules/source/services/type-source-serialize'

/**
 * Импорт типов из OpenAPI YAML схемы
 */
export function parseOpenApiSchema(yamlText: string): RType[] {
  const parsed = parseYaml(yamlText)
  const types: RType[] = []

  // 1. Импорт типов (schemas)
  const schemas = parsed?.components?.schemas
  if (schemas && typeof schemas === 'object') {
    for (const [name, schema] of Object.entries<any>(schemas)) {
      if (schema.type !== 'object') {
        continue
      }

      const rtype = new RType(name)
      const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
      const sourceFields: TypeSourceField[] = []

      for (const [propName, propSchema] of Object.entries<any>(
        schema.properties || {},
      )) {
        const isArray = propSchema.type === 'array'
        const optional = !required.has(propName)
        const constraints = propSchema.type === 'array' ? propSchema.items ?? {} : propSchema
        sourceFields.push({
          key: propName,
          type: resolveOpenApiExpression(constraints),
          optional,
          array: isArray,
          description: typeof propSchema.description === 'string' ? propSchema.description : undefined,
          min: typeof constraints.minimum === 'number' ? constraints.minimum : undefined,
          max: typeof constraints.maximum === 'number' ? constraints.maximum : undefined,
          examples: propSchema.example === undefined ? [] : [propSchema.example],
        })
      }

      rtype.sourceVersion = 1
      rtype.source = serializeTypeSourceDocument({ definition: { kind: 'object', fields: sourceFields } })

      types.push(rtype)
    }
  }

  // OpenAPI import now creates only domain types. Query source must be authored
  // explicitly because its props, body and output graph are part of one source contract.
  return types
}

function resolveOpenApiExpression(schema: any): TypeSourceExpression {
  if (schema?.$ref) {
    return { kind: 'reference', identity: resolveOpenApiType(schema) }
  }
  if (schema?.type === 'object' || schema?.properties) {
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
    return {
      kind: 'object',
      fields: Object.entries<any>(schema.properties ?? {}).map(([key, property]) => {
        const array = property?.type === 'array'
        const value = array ? property.items ?? {} : property
        return {
          key,
          type: resolveOpenApiExpression(value),
          optional: !required.has(key),
          array,
          description: typeof property?.description === 'string' ? property.description : undefined,
          examples: property?.example === undefined ? [] : [property.example],
        }
      }),
    }
  }
  return { kind: 'reference', identity: resolveOpenApiType(schema) }
}

function resolveOpenApiType(prop: any): string {
  if (prop.$ref) {
    const match = prop.$ref.match(/#\/components\/schemas\/(.+)/)
    if (match?.[1] === 'UUID') {
      return 'ID'
    }
    return match ? match[1] : 'Unknown'
  }

  if (prop.type === 'array') {
    const itemType = resolveOpenApiType(prop.items || {})
    return itemType
  }

  if (prop.type === 'integer') {
    return 'Number'
  }
  if (prop.type === 'number') {
    return 'Number'
  }
  if (prop.type === 'string') {
    return 'String'
  }
  if (prop.type === 'boolean') {
    return 'Boolean'
  }
  if (prop.type === 'null') {
    return 'Null'
  }

  return 'Any'
}
