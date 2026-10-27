import type {
  DefinitionNode,
  EnumTypeDefinitionNode,
  FieldDefinitionNode,
  InputObjectTypeDefinitionNode,
  InputValueDefinitionNode,
  InterfaceTypeDefinitionNode,
  ObjectTypeDefinitionNode,
  TypeNode,
  UnionTypeDefinitionNode,
} from 'graphql'
import type {
  DocumentImportParser,
  DocumentImportParserResult,
  ParsedDocumentImportCandidate,
} from '@/features/core/modules/document-import/services/parsers/DocumentImportParser'
import type { ProgramMetadataMap, ProgramMetadataValue } from '@/features/core/modules/program/domain/types/program-metadata.types'
import type { TypeSourceDefinition, TypeSourceExpression, TypeSourceField } from '@/features/core/modules/source/domain/types/type-source.types'
import type { GraphQLSchemaInput } from '@/features/core/modules/source/services/graphql-schema'

import { GraphQLError, Kind, parse, printSchema, valueFromASTUntyped } from 'graphql'

import { loadGraphQLSchema } from '@/features/core/modules/source/services/graphql-schema'
import { serializeTypeSourceDocument } from '@/features/core/modules/source/services/type-source-serialize'

type ImportableDefinitionNode
  = | ObjectTypeDefinitionNode
    | InterfaceTypeDefinitionNode
    | InputObjectTypeDefinitionNode
    | EnumTypeDefinitionNode
    | UnionTypeDefinitionNode

const IMPORTABLE_KINDS: ReadonlySet<string> = new Set([
  Kind.OBJECT_TYPE_DEFINITION,
  Kind.INTERFACE_TYPE_DEFINITION,
  Kind.INPUT_OBJECT_TYPE_DEFINITION,
  Kind.ENUM_TYPE_DEFINITION,
  Kind.UNION_TYPE_DEFINITION,
])

/**
 * Преобразует GraphQL SDL или JSON introspection в черновики Type Source без изменения Domain.
 */
export class GraphQLDocumentImportParser implements DocumentImportParser {
  public readonly format = 'graphql' as const

  /**
   * Возвращает поддержанные object/interface/input/enum/union types и нормализует scalar aliases.
   * Текст, начинающийся с `{`, читается как результат introspection и печатается в SDL.
   */
  public parse(source: string): DocumentImportParserResult {
    const sdl = source.trimStart().startsWith('{') ? introspectionToSDL(source) : { sdl: source }
    if (!('sdl' in sdl)) {
      return { candidates: [], diagnostics: sdl.diagnostics, skipped: [] }
    }
    try {
      const document = parse(sdl.sdl)
      const operationRoots = new Set(['Query', 'Mutation', 'Subscription'])
      for (const definition of document.definitions) {
        if (definition.kind === Kind.SCHEMA_DEFINITION) {
          for (const operation of definition.operationTypes) {
            operationRoots.add(operation.type.name.value)
          }
        }
      }

      const result: DocumentImportParserResult = { candidates: [], diagnostics: [], skipped: [] }
      const scalarMappings = collectGraphQLScalarAliases(document.definitions)
      result.diagnostics.push(...scalarMappings.diagnostics)
      const implementations = collectGraphQLImplementations(document.definitions)
      const identities = new Set<string>()
      for (const definition of document.definitions) {
        if (definition.kind === Kind.SCALAR_TYPE_DEFINITION) {
          continue
        }
        if (!isImportableDefinition(definition)) {
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

        if (definition.kind === Kind.UNION_TYPE_DEFINITION && new Set(definition.types?.map(type => type.name.value)).size < 2) {
          result.skipped.push({
            kind: definition.kind,
            identity,
            reason: 'GraphQL union with fewer than two member types cannot be expressed: Type DSL unionOf requires at least two variants.',
          })
          continue
        }

        identities.add(identity)
        result.candidates.push(graphqlTypeCandidate(definition, scalarMappings.aliases, implementations))
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

function graphqlTypeCandidate(
  definition: ImportableDefinitionNode,
  scalarAliases: ReadonlyMap<string, string>,
  implementations: ReadonlyMap<string, string[]>,
): ParsedDocumentImportCandidate {
  const identity = definition.name.value
  const candidateId = `type:${identity}`
  const diagnostics: ParsedDocumentImportCandidate['diagnostics'] = []
  let typeDefinition: TypeSourceDefinition
  let graphqlMetadata: Record<string, ProgramMetadataValue> | null = null

  if (definition.kind === Kind.ENUM_TYPE_DEFINITION) {
    typeDefinition = { kind: 'enum', values: definition.values?.map(value => value.name.value) ?? [] }
  }
  else if (definition.kind === Kind.UNION_TYPE_DEFINITION) {
    const members = [...new Set(definition.types?.map(type => type.name.value) ?? [])]
    typeDefinition = {
      kind: 'union',
      variants: members.map(member => ({ kind: 'reference' as const, identity: member })),
    }
    graphqlMetadata = { kind: 'union' }
  }
  else if (definition.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
    const fields = definition.fields ?? []
    typeDefinition = { kind: 'object', fields: fields.map(field => graphqlInputField(field, scalarAliases)) }
    graphqlMetadata = { kind: 'input' }
    const defaults = graphqlInputDefaults(fields)
    if (defaults) {
      graphqlMetadata.defaults = defaults
    }
  }
  else {
    const fields = definition.fields ?? []
    typeDefinition = { kind: 'object', fields: fields.map(field => graphqlOutputField(field, scalarAliases)) }
    const interfaces = definition.interfaces?.map(item => item.name.value) ?? []
    if (definition.kind === Kind.INTERFACE_TYPE_DEFINITION) {
      graphqlMetadata = { kind: 'interface', implementations: implementations.get(identity) ?? [] }
    }
    if (interfaces.length) {
      graphqlMetadata = { ...(graphqlMetadata ?? { kind: 'object' }), interfaces }
    }
    const withArguments = fields.filter(field => field.arguments?.length).map(field => field.name.value)
    if (withArguments.length) {
      diagnostics.push({
        severity: 'info',
        code: 'document-import-graphql-field-arguments',
        message: `GraphQL field arguments are not represented in Type DSL and were omitted: ${withArguments.join(', ')}.`,
        candidateId,
      })
    }
  }

  // defineMetadata пишется напрямую: patchDocumentMetadata для Type умеет только object definitions,
  // а Type compiler принимает defineMetadata рядом с любым defineType(...).
  const metadata: ProgramMetadataMap | null = graphqlMetadata ? { graphql: graphqlMetadata } : null
  const source = `${metadata ? `defineMetadata(${JSON.stringify(metadata, null, 2)})\n\n` : ''}${serializeTypeSourceDocument({ definition: typeDefinition })}`

  const fields = typeDefinition.kind === 'object' ? typeDefinition.fields : []
  return {
    id: candidateId,
    identity,
    displayName: identity,
    description: definition.description?.value,
    source,
    fields: fields.length,
    requiredFields: fields.filter(field => !field.optional).length,
    diagnostics,
  }
}

function graphqlOutputField(field: FieldDefinitionNode, scalarAliases: ReadonlyMap<string, string>): TypeSourceField {
  const resolved = resolveGraphQLFieldType(field.type, scalarAliases)
  return {
    key: field.name.value,
    type: resolved.type,
    optional: resolved.optional,
    array: resolved.array,
    description: field.description?.value,
    examples: [],
  }
}

// Non-null input field с default value клиент может не передавать, поэтому он optional.
function graphqlInputField(field: InputValueDefinitionNode, scalarAliases: ReadonlyMap<string, string>): TypeSourceField {
  const resolved = resolveGraphQLFieldType(field.type, scalarAliases)
  return {
    key: field.name.value,
    type: resolved.type,
    optional: resolved.optional || field.defaultValue != null,
    array: resolved.array,
    description: field.description?.value,
    examples: [],
  }
}

// Type DSL не имеет default values: они сохраняются в metadata graphql.defaults.
function graphqlInputDefaults(fields: readonly InputValueDefinitionNode[]): Record<string, ProgramMetadataValue> | null {
  const defaults: Record<string, ProgramMetadataValue> = {}
  for (const field of fields) {
    if (field.defaultValue) {
      defaults[field.name.value] = valueFromASTUntyped(field.defaultValue) as ProgramMetadataValue
    }
  }
  return Object.keys(defaults).length ? defaults : null
}

// Внешний list становится modifier .array(), вложенные списки — arrayOf(...). Nullability элементов
// списка Type DSL не выражает.
function resolveGraphQLFieldType(
  type: TypeNode,
  scalarAliases: ReadonlyMap<string, string>,
): { type: TypeSourceExpression, array: boolean, optional: boolean } {
  let depth = 0
  const optional = type.kind !== Kind.NON_NULL_TYPE

  const unwrap = (value: TypeNode): string => {
    if (value.kind === Kind.NON_NULL_TYPE) {
      return unwrap(value.type)
    }
    if (value.kind === Kind.LIST_TYPE) {
      depth += 1
      return unwrap(value.type)
    }
    return scalarAliases.get(value.name.value) ?? resolveGraphQLNamedType(value.name.value)
  }

  let expression: TypeSourceExpression = { kind: 'reference', identity: unwrap(type) }
  for (let level = 1; level < depth; level += 1) {
    expression = { kind: 'array', items: expression }
  }
  return { type: expression, array: depth > 0, optional }
}

function resolveGraphQLNamedType(identity: string): string {
  if (identity === 'Int' || identity === 'Float') {
    return 'Number'
  }
  return identity
}

function collectGraphQLScalarAliases(
  definitions: readonly { kind: string, name?: { value: string } }[],
): { aliases: ReadonlyMap<string, string>, diagnostics: DocumentImportParserResult['diagnostics'] } {
  const aliases = new Map<string, string>()
  const diagnostics: DocumentImportParserResult['diagnostics'] = []
  for (const definition of definitions) {
    if (definition.kind !== Kind.SCALAR_TYPE_DEFINITION || !definition.name?.value) {
      continue
    }
    const identity = definition.name.value
    const primitive = resolveGraphQLScalar(identity)
    aliases.set(identity, primitive)
    if (primitive === 'Any') {
      diagnostics.push({
        severity: 'warning',
        code: 'document-import-graphql-scalar-fallback',
        message: `GraphQL scalar "${identity}" has no known Endge primitive mapping and was mapped to Any.`,
      })
    }
  }
  return { aliases, diagnostics }
}

function resolveGraphQLScalar(identity: string): string {
  const normalized = identity.toLowerCase()
  if (['int', 'float', 'bigint', 'biginteger', 'bigdecimal', 'decimal', 'long', 'short'].includes(normalized)) {
    return 'Number'
  }
  if (normalized === 'boolean') {
    return 'Boolean'
  }
  if (['id', 'uuid', 'guid'].includes(normalized)) {
    return 'ID'
  }
  if (['date', 'localdate'].includes(normalized)) {
    return 'Date'
  }
  if (['datetime', 'instant', 'timestamp'].includes(normalized)) {
    return 'DateTime'
  }
  if (['time', 'localtime'].includes(normalized)) {
    return 'Time'
  }
  if (['json', 'jsonobject'].includes(normalized)) {
    return 'JSON'
  }
  if (['string', 'duration', 'url', 'uri', 'email'].includes(normalized)) {
    return 'String'
  }
  return 'Any'
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

function isImportableDefinition(definition: DefinitionNode): definition is ImportableDefinitionNode {
  return IMPORTABLE_KINDS.has(definition.kind)
}

// Interface -> object/interface types, которые его реализуют, в порядке объявления.
function collectGraphQLImplementations(definitions: readonly DefinitionNode[]): ReadonlyMap<string, string[]> {
  const implementations = new Map<string, string[]>()
  for (const definition of definitions) {
    if (definition.kind !== Kind.OBJECT_TYPE_DEFINITION && definition.kind !== Kind.INTERFACE_TYPE_DEFINITION) {
      continue
    }
    for (const item of definition.interfaces ?? []) {
      const list = implementations.get(item.name.value) ?? []
      list.push(definition.name.value)
      implementations.set(item.name.value, list)
    }
  }
  return implementations
}

// JSON introspection -> SDL через buildClientSchema/printSchema, чтобы SDL и introspection шли одним путём.
function introspectionToSDL(source: string): { sdl: string } | { diagnostics: DocumentImportParserResult['diagnostics'] } {
  let value: unknown
  try {
    value = JSON.parse(source)
  }
  catch (error) {
    return {
      diagnostics: [{
        severity: 'error',
        code: 'document-import-graphql-introspection-json',
        message: `GraphQL introspection JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      }],
    }
  }
  // Источник начинается с `{`, поэтому JSON.parse вернул объект.
  const loaded = loadGraphQLSchema(value as GraphQLSchemaInput)
  if (!loaded.schema) {
    return {
      diagnostics: loaded.diagnostics.map(diagnostic => ({
        severity: 'error' as const,
        code: 'document-import-graphql-introspection-invalid',
        message: diagnostic.message,
      })),
    }
  }
  return { sdl: printSchema(loaded.schema) }
}
