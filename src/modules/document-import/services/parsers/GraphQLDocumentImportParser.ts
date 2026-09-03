import type { ObjectTypeDefinitionNode, TypeNode } from 'graphql'
import type { DocumentImportParser, DocumentImportParserResult } from '@/modules/document-import/services/parsers/DocumentImportParser'
import type { TypeSourceField } from '@/modules/source/domain/types/type-source.types'

import { GraphQLError, Kind, parse } from 'graphql'

import { serializeTypeSourceDocument } from '@/modules/source/services/type-source-serialize'

/** Преобразует GraphQL SDL в черновики Type Source без изменения Domain. */
export class GraphQLDocumentImportParser implements DocumentImportParser {
  public readonly format = 'graphql' as const

  /** Возвращает поддержанные object types и явный список пропущенных конструкций. */
  public parse(source: string): DocumentImportParserResult {
    try {
      const document = parse(source)
      const operationRoots = new Set(['Query', 'Mutation', 'Subscription'])
      for (const definition of document.definitions) {
        if (definition.kind === Kind.SCHEMA_DEFINITION) {
          for (const operation of definition.operationTypes) {
            operationRoots.add(operation.type.name.value)
          }
        }
      }

      const result: DocumentImportParserResult = { candidates: [], diagnostics: [], skipped: [] }
      const identities = new Set<string>()
      for (const definition of document.definitions) {
        if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION) {
          const skipped = graphqlSkippedDefinition(definition)
          if (skipped) {
            result.skipped.push(skipped)
          }
          continue
        }

        const identity = definition.name.value
        if (operationRoots.has(identity)) {
          result.skipped.push({
            kind: 'graphql-operation-root',
            identity,
            reason: 'GraphQL operation roots are not mapped to Endge Query documents yet.',
          })
          continue
        }
        if (identities.has(identity)) {
          result.diagnostics.push({
            severity: 'error',
            code: 'document-import-duplicate-identity',
            message: `GraphQL type "${identity}" is declared more than once.`,
          })
          continue
        }

        identities.add(identity)
        result.candidates.push(graphqlObjectTypeCandidate(definition))
      }
      return result
    }
    catch (error) {
      const location = error instanceof GraphQLError ? error.locations?.[0] : undefined
      return {
        candidates: [],
        diagnostics: [{
          severity: 'error',
          code: 'document-import-graphql-syntax',
          message: error instanceof Error ? error.message : String(error),
          line: location?.line,
          column: location?.column,
        }],
        skipped: [],
      }
    }
  }
}

function graphqlObjectTypeCandidate(definition: ObjectTypeDefinitionNode) {
  const fields: TypeSourceField[] = (definition.fields ?? []).map((field) => {
    const resolved = resolveGraphQLFieldType(field.type)
    return {
      key: field.name.value,
      type: { kind: 'reference' as const, identity: resolved.identity },
      optional: resolved.optional,
      array: resolved.array,
      description: field.description?.value,
      examples: [],
    }
  })
  const identity = definition.name.value
  return {
    id: `type:${identity}`,
    identity,
    displayName: identity,
    description: definition.description?.value,
    source: serializeTypeSourceDocument({ definition: { kind: 'object', fields } }),
    fields: fields.length,
    requiredFields: fields.filter(field => !field.optional).length,
    diagnostics: [],
  }
}

function resolveGraphQLFieldType(type: TypeNode): { identity: string, array: boolean, optional: boolean } {
  let array = false
  const optional = type.kind !== Kind.NON_NULL_TYPE

  const unwrap = (value: TypeNode): string => {
    if (value.kind === Kind.NON_NULL_TYPE) {
      return unwrap(value.type)
    }
    if (value.kind === Kind.LIST_TYPE) {
      array = true
      return unwrap(value.type)
    }
    return resolveGraphQLNamedType(value.name.value)
  }

  return { identity: unwrap(type), array, optional }
}

function resolveGraphQLNamedType(identity: string): string {
  if (identity === 'Int' || identity === 'Float') {
    return 'Number'
  }
  return identity
}

function graphqlSkippedDefinition(definition: { kind: string, name?: { value: string } }) {
  if (definition.kind === Kind.SCHEMA_DEFINITION || definition.kind === Kind.DIRECTIVE_DEFINITION) {
    return null
  }
  if (!definition.name?.value) {
    return null
  }
  return {
    kind: definition.kind,
    identity: definition.name.value,
    reason: `GraphQL ${definition.kind} is not mapped to an Endge document yet.`,
  }
}
