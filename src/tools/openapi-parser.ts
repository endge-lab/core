import { parse as parseYaml } from 'yaml'
import { RType } from '@/domain/entities/reflect/RType'
import { RField } from '@/domain/entities/reflect/RField'
import { Endge } from '@/model/endge/endge'
import { RQuery } from '@/domain/entities/reflect/RQuery'

import {QueryType} from "@/domain/types/document.types";

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

  // 2. Импорт запросов (paths)
  const paths = parsed?.paths
  if (paths && typeof paths === 'object') {
    for (const [path, pathItem] of Object.entries<any>(paths)) {
      for (const method of ['get', 'post', 'put', 'delete']) {
        const operation = pathItem?.[method]
        if (!operation) continue

        const name =
          operation.operationId || `${method}_${path.replace(/[\/{}]/g, '_')}`
        const rquery = new RQuery()
        rquery.id = name
        rquery.name = name
        rquery.query = path
        rquery.returnField = new RField('result', 'String', false)
        rquery.type = QueryType.REST

        // Обработка параметров
        for (const param of operation.parameters || []) {
          const paramType = resolveOpenApiType(param.schema || {})
          rquery.params.set(param.name, new RField(param.name, paramType))
        }

        // Обработка requestBody - application/json - schema - properties
        const bodySchema =
          operation.requestBody?.content?.['application/json']?.schema
        if (bodySchema?.properties) {
          for (const [propName, propSchema] of Object.entries<any>(
            bodySchema.properties,
          )) {
            const type = resolveOpenApiType(propSchema)
            const isArray = propSchema.type === 'array'
            rquery.params.set(propName, new RField(propName, type, isArray))
          }
        }

        // Попытка угадать тип ответа
        const responseSchema =
          operation.responses?.['200']?.content?.['application/json']?.schema ||
          operation.responses?.['201']?.content?.['application/json']?.schema

        if (responseSchema) {
          const returnType = resolveOpenApiType(responseSchema)
          const isArray = responseSchema.type === 'array'
          rquery.returnField = new RField('result', returnType, isArray)
        }

        Endge.domain.addQuery(rquery)
      }
    }
  }
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
