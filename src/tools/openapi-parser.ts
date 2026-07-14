import { parse as parseYaml } from 'yaml'
import { RType } from '@/domain/entities/reflect/RType'
import { RField } from '@/domain/entities/reflect/RField'
import { Endge } from '@/model/endge/kernel/endge'

/**
 * Импорт типов из OpenAPI YAML схемы
 */
export function importOpenApiSchemaToDomain(yamlText: string): void {
  const parsed = parseYaml(yamlText)

  // 1. Импорт типов (schemas)
  const schemas = parsed?.components?.schemas
  if (schemas && typeof schemas === 'object') {
    for (const [name, schema] of Object.entries<any>(schemas)) {
      if (schema.type !== 'object') continue

      const rtype = new RType(name)

      for (const [propName, propSchema] of Object.entries<any>(
        schema.properties || {},
      )) {
        const type = resolveOpenApiType(propSchema)
        const isArray = propSchema.type === 'array'
        const field = new RField(propName, type, isArray)
        rtype.addField(field)
      }

      Endge.domain.addType(rtype)
    }
  }

  // OpenAPI import now creates only domain types. Query source must be authored
  // explicitly because its props, body and output graph are part of one source contract.
}

function resolveOpenApiType(prop: any): string {
  if (prop.$ref) {
    const match = prop.$ref.match(/#\/components\/schemas\/(.+)/)
    if (match?.[1] === 'UUID') return 'ID'
    return match ? match[1] : 'Unknown'
  }

  if (prop.type === 'array') {
    const itemType = resolveOpenApiType(prop.items || {})
    return itemType
  }

  if (prop.type === 'integer') return 'Number'
  if (prop.type === 'number') return 'Number'
  if (prop.type === 'string') return 'String'
  if (prop.type === 'boolean') return 'Boolean'
  if (prop.type === 'null') return 'Null'

  return 'Unknown'
}
