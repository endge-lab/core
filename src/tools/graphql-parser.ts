import type { DocumentNode, ObjectTypeDefinitionNode } from 'graphql'
import { parse, visit } from 'graphql'
import { Endge } from '@/model/endge/kernel/endge'
import { RType } from '@/domain/entities/reflect/RType'
import { RField } from '@/domain/entities/reflect/RField'
import type { TypeSourceField } from '@/domain/types/source/type-source.types'
import { serializeTypeSourceDocument } from '@/model/services/source-engine/type-source-serialize'

/**
 * Вспомогательная утилита для парсинга GraphQL-схемы в объектную структуру домена.
 * На вход подаем просто строку с GraphQL-схемой.
 */
export function importGqlSchemaToDomain(schema: string): void {
  const document: DocumentNode = parse(schema)

  const typeMap = new Map<string, RType>()

  visit(document, {
    ObjectTypeDefinition(node: ObjectTypeDefinitionNode) {
      const name = node.name.value

      // Query source v2 currently supports REST only; GraphQL schema import keeps types.
      if (name === 'Query') {
        return
      }

      if (['Mutation', 'Subscription', 'Query'].includes(name)) return

      const sourceFields: TypeSourceField[] = []
      const fields = (node.fields || []).map((field) => {
        const { typeStr, isArray, optional } = resolveFieldTypeWithMeta(field.type)
        sourceFields.push({
          key: field.name.value,
          type: { kind: 'reference', identity: typeStr },
          optional,
          array: isArray,
          description: field.description?.value,
          examples: [],
        })
        return new RField(field.name.value, typeStr, isArray, optional)
      })

      const rType = new RType(name)
      fields.forEach((field) => rType.addField(field))
      rType.sourceVersion = 1
      rType.source = serializeTypeSourceDocument({ definition: { kind: 'object', fields: sourceFields } })
      typeMap.set(name, rType)
    },
  })

  // Регистрируем в Endge
  for (const [, type] of typeMap) {
    Endge.domain.addType(type)
  }

}

function resolveFieldTypeWithMeta(type: any): {
  typeStr: string
  isArray: boolean
  optional: boolean
} {
  let isArray = false
  const optional = type?.kind !== 'NonNullType'

  function unwrap(t: any): string {
    if (t.kind === 'NonNullType') return unwrap(t.type)
    if (t.kind === 'ListType') {
      isArray = true
      return unwrap(t.type)
    }
    if (t.kind === 'NamedType') return resolveGraphQlNamedType(t.name.value)
    return 'Any'
  }

  return {
    typeStr: unwrap(type),
    isArray,
    optional,
  }
}

function resolveGraphQlNamedType(value: string): string {
  if (value === 'Int' || value === 'Float') return 'Number'
  if (value === 'String' || value === 'Boolean' || value === 'ID') return value
  return value
}
