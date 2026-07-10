import type { DocumentNode, ObjectTypeDefinitionNode } from 'graphql'
import { parse, visit } from 'graphql'
import { Endge } from '@/model/endge/endge'
import { RType } from '@/domain/entities/reflect/RType'
import { RField } from '@/domain/entities/reflect/RField'

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

      const fields = (node.fields || []).map((field) => {
        const { typeStr, isArray } = resolveFieldTypeWithMeta(field.type)
        return new RField(field.name.value, typeStr, isArray)
      })

      const rType = new RType(name)
      fields.forEach((field) => rType.addField(field))
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
} {
  let isArray = false

  function unwrap(t: any): string {
    if (t.kind === 'NonNullType') return unwrap(t.type)
    if (t.kind === 'ListType') {
      isArray = true
      return unwrap(t.type)
    }
    if (t.kind === 'NamedType') return t.name.value
    return 'Unknown'
  }

  return {
    typeStr: unwrap(type),
    isArray,
  }
}
