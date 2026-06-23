import type { DocumentNode, ObjectTypeDefinitionNode } from 'graphql'
import { parse, visit } from 'graphql'
import { Endge } from '@/model/endge/endge'
import { RType } from '@/domain/entities/reflect/RType'
import { RField } from '@/domain/entities/reflect/RField'
import { RQuery } from '@/domain/entities/reflect/RQuery'

import {QueryType} from "@/domain/types/document.types";

/**
 * Вспомогательная утилита для парсинга GraphQL-схемы в объектную структуру домена.
 * На вход подаем просто строку с GraphQL-схемой.
 */
export function importGqlSchemaToDomain(schema: string): void {
  const document: DocumentNode = parse(schema)

  const typeMap = new Map<string, RType>()
  const queryList: RQuery[] = []

  visit(document, {
    ObjectTypeDefinition(node: ObjectTypeDefinitionNode) {
      const name = node.name.value

      // Обработка запросов
      if (name === 'Query') {
        for (const field of node.fields || []) {
          const { typeStr, isArray } = resolveFieldTypeWithMeta(field.type)

          const rQuery = new RQuery()
          rQuery.id = field.name.value
          rQuery.name = field.name.value
          rQuery.query = field.name.value
          rQuery.type = QueryType.GraphQL
          rQuery.returnField = new RField('result', typeStr, isArray)

          for (const arg of field.arguments || []) {
            const argType = resolveFieldType(arg.type)
            rQuery.params.set(
              arg.name.value,
              new RField(arg.name.value, argType),
            )
          }

          queryList.push(rQuery)
        }

        return // не добавляем Query как тип
      }

      if (['Mutation', 'Subscription', 'Query'].includes(name)) return

      const fields = (node.fields || []).map((field) => {
        const { typeStr, isArray } = resolveFieldTypeWithMeta(field.type)
        return new RField(field.name.value, typeStr, isArray)
      })

      const rType = new RType(name)
      fields.forEach((field) => rType.addField(field))
      typeMap.set(name, rType)

      // Запросы из Query
      if (name === 'Query') {
        for (const field of node.fields || []) {
          const returnType = resolveFieldType(field.type)
          const rQuery = new RQuery(
            field.name.value,
            new RField('result', returnType),
          )

          for (const arg of field.arguments || []) {
            const argType = resolveFieldType(arg.type)
            rQuery.params.set(
              arg.name.value,
              new RField(arg.name.value, argType),
            )
          }

          queryList.push(rQuery)
        }
      }
    },
  })

  // Регистрируем в Endge
  for (const [, type] of typeMap) {
    Endge.domain.addType(type)
  }

  for (const query of queryList) {
    Endge.domain.addQuery(query)
  }
}

function resolveFieldType(type: any): string {
  if (type.kind === 'NamedType') return type.name.value
  if (type.kind === 'NonNullType') return resolveFieldType(type.type) + '!'
  if (type.kind === 'ListType') return `[${resolveFieldType(type.type)}]`
  return 'Unknown'
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
