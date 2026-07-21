import { parse as parseTS } from '@babel/parser'

import type {
  TypeSourceDefinition,
  TypeSourceDocument,
  TypeSourceExpression,
  TypeSourceField,
} from '@/domain/types/source/type-source.types'

export interface TypeScriptTypeDeclarationRange {
  start: number
  end: number
}

/** Editor-facing analysis of one top-level TypeScript type declaration. */
export interface TypeScriptTypeDeclarationAnalysis {
  kind: 'interface' | 'type'
  identity: string
  range: TypeScriptTypeDeclarationRange
  actionAnchor: number
  source: string
  document: TypeSourceDocument | null
  dependencies: string[]
  unsupportedReason: string | null
}

class UnsupportedTypeScriptTypeError extends Error {}

interface ConversionContext {
  dependencies: Set<string>
}

const PRIMITIVE_REFERENCES: Record<string, string> = {
  TSStringKeyword: 'String',
  TSNumberKeyword: 'Number',
  TSBooleanKeyword: 'Boolean',
  TSUnknownKeyword: 'Any',
  TSAnyKeyword: 'Any',
  TSObjectKeyword: 'Object',
  TSNullKeyword: 'Null',
}

/** Parses top-level `interface` and `type` declarations from one TS script block. */
export function analyzeTypeScriptTypeDeclarations(source: string): TypeScriptTypeDeclarationAnalysis[] {
  let ast: any
  try {
    ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any
  }
  catch {
    return []
  }

  return (ast.program.body as any[])
    .map(statement => analyzeStatement(statement, source))
    .filter((item): item is TypeScriptTypeDeclarationAnalysis => item != null)
}

function analyzeStatement(statement: any, source: string): TypeScriptTypeDeclarationAnalysis | null {
  const declaration = statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration'
    ? statement.declaration
    : statement
  if (!declaration || (declaration.type !== 'TSInterfaceDeclaration' && declaration.type !== 'TSTypeAliasDeclaration'))
    return null

  const identity = String(declaration.id?.name ?? '').trim()
  if (!identity || statement.start == null || statement.end == null)
    return null

  const context: ConversionContext = { dependencies: new Set() }
  let document: TypeSourceDocument | null = null
  let unsupportedReason: string | null = null
  try {
    if (declaration.typeParameters?.params?.length)
      unsupported(`Generic ${declaration.type === 'TSInterfaceDeclaration' ? 'interface' : 'type alias'} пока нельзя преобразовать в RType.`)
    document = {
      definition: declaration.type === 'TSInterfaceDeclaration'
        ? convertInterfaceDeclaration(declaration, context)
        : convertRootDefinition(declaration.typeAnnotation, context),
    }
  }
  catch (error) {
    unsupportedReason = error instanceof Error ? error.message : String(error)
  }

  return {
    kind: declaration.type === 'TSInterfaceDeclaration' ? 'interface' : 'type',
    identity,
    range: { start: Number(statement.start), end: Number(statement.end) },
    actionAnchor: findDeclarationHeaderAnchor(source, Number(statement.start), Number(statement.end)),
    source: source.slice(Number(statement.start), Number(statement.end)),
    document,
    dependencies: [...context.dependencies],
    unsupportedReason,
  }
}

function findDeclarationHeaderAnchor(source: string, start: number, end: number): number {
  const lineBreak = source.indexOf('\n', start)
  if (lineBreak < 0 || lineBreak > end)
    return end
  return lineBreak > start && source[lineBreak - 1] === '\r' ? lineBreak - 1 : lineBreak
}

function convertInterfaceDeclaration(node: any, context: ConversionContext): TypeSourceDefinition {
  if (node.extends?.length)
    unsupported('Interface extends пока нельзя преобразовать без потери семантики.')

  return convertObjectMembers(node.body?.body ?? [], context)
}

function convertRootDefinition(node: any, context: ConversionContext): TypeSourceDefinition {
  const unwrapped = unwrapType(node)
  if (unwrapped?.type === 'TSTypeLiteral')
    return convertObjectMembers(unwrapped.members ?? [], context)
  if (unwrapped?.type === 'TSUnionType')
    return convertUnion(unwrapped, context)
  if (unwrapped?.type === 'TSArrayType') {
    return {
      kind: 'array',
      items: convertExpression(unwrapped.elementType, context),
    }
  }
  if (isArrayReference(unwrapped)) {
    return {
      kind: 'array',
      items: convertExpression(unwrapped.typeParameters.params[0], context),
    }
  }

  unsupported('RType v1 поддерживает object, union/enum и array как корневые формы.')
}

function convertObjectMembers(members: any[], context: ConversionContext): TypeSourceDefinition {
  const fields: TypeSourceField[] = []
  for (const member of members) {
    if (member.type !== 'TSPropertySignature')
      unsupported('Methods, call signatures и index signatures пока не поддерживаются.')
    if (member.computed)
      unsupported('Computed property names пока не поддерживаются.')
    if (member.readonly)
      unsupported('Readonly fields нельзя преобразовать без потери семантики.')

    const key = readPropertyKey(member.key)
    const annotation = member.typeAnnotation?.typeAnnotation
    if (!key || !annotation)
      unsupported('Каждое поле должно иметь статическое имя и явный type annotation.')

    const fieldType = convertFieldType(annotation, context)
    fields.push({
      key,
      type: fieldType.type,
      optional: member.optional === true,
      array: fieldType.array,
      examples: [],
      ...(readDescription(member) ? { description: readDescription(member) } : {}),
    })
  }
  return { kind: 'object', fields }
}

function convertFieldType(node: any, context: ConversionContext): { type: TypeSourceExpression, array: boolean } {
  const unwrapped = unwrapType(node)
  if (unwrapped?.type === 'TSArrayType') {
    return {
      type: convertExpression(unwrapped.elementType, context),
      array: true,
    }
  }
  if (isArrayReference(unwrapped)) {
    return {
      type: convertExpression(unwrapped.typeParameters.params[0], context),
      array: true,
    }
  }
  return { type: convertExpression(unwrapped, context), array: false }
}

function convertExpression(node: any, context: ConversionContext): TypeSourceExpression {
  const unwrapped = unwrapType(node)
  const primitive = PRIMITIVE_REFERENCES[unwrapped?.type]
  if (primitive)
    return { kind: 'reference', identity: primitive }

  if (unwrapped?.type === 'TSTypeLiteral')
    return convertObjectMembers(unwrapped.members ?? [], context)
  if (unwrapped?.type === 'TSUnionType')
    return convertUnion(unwrapped, context)
  if (unwrapped?.type === 'TSArrayType') {
    return {
      kind: 'array',
      items: convertExpression(unwrapped.elementType, context),
    }
  }
  if (isArrayReference(unwrapped)) {
    return {
      kind: 'array',
      items: convertExpression(unwrapped.typeParameters.params[0], context),
    }
  }
  if (unwrapped?.type === 'TSLiteralType') {
    return {
      kind: 'enum',
      values: [readLiteralValue(unwrapped.literal)],
    }
  }
  if (unwrapped?.type === 'TSTypeReference') {
    if (unwrapped.typeParameters?.params?.length)
      unsupported(`Generic type "${readTypeReferenceName(unwrapped.typeName) || 'unknown'}" пока не поддерживается.`)
    const identity = readTypeReferenceName(unwrapped.typeName)
    if (!identity)
      unsupported('Qualified type references пока не поддерживаются.')
    context.dependencies.add(identity)
    return { kind: 'reference', identity }
  }

  unsupported(`TypeScript form "${unwrapped?.type ?? 'unknown'}" пока не поддерживается.`)
}

function convertUnion(node: any, context: ConversionContext): TypeSourceDefinition {
  const members = node.types ?? []
  if (members.length < 2)
    unsupported('Union должен содержать хотя бы два варианта.')

  if (members.every((member: any) => unwrapType(member)?.type === 'TSLiteralType')) {
    const values = members.map((member: any) => readLiteralValue(unwrapType(member).literal))
    if (new Set(values.map((value: unknown) => typeof value)).size > 1)
      unsupported('Mixed literal unions нельзя преобразовать в enumOf.')
    return { kind: 'enum', values }
  }

  return {
    kind: 'union',
    variants: members.map((member: any) => convertExpression(member, context)),
  }
}

function unwrapType(node: any): any {
  let current = node
  while (current?.type === 'TSParenthesizedType')
    current = current.typeAnnotation
  return current
}

function isArrayReference(node: any): boolean {
  return node?.type === 'TSTypeReference'
    && node.typeName?.type === 'Identifier'
    && node.typeName.name === 'Array'
    && node.typeParameters?.params?.length === 1
}

function readTypeReferenceName(node: any): string | null {
  return node?.type === 'Identifier' ? String(node.name) : null
}

function readPropertyKey(node: any): string | null {
  if (node?.type === 'Identifier' || node?.type === 'StringLiteral' || node?.type === 'NumericLiteral')
    return String(node.name ?? node.value)
  return null
}

function readLiteralValue(node: any): string | number | boolean {
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral' || node?.type === 'BooleanLiteral')
    return node.value
  unsupported('Поддерживаются только string, number и boolean literal types.')
}

function readDescription(node: any): string | undefined {
  const comment = node.leadingComments?.at(-1)?.value
  if (typeof comment !== 'string')
    return undefined
  const value = comment
    .split('\n')
    .map((line: string) => line.replace(/^\s*\*?\s?/, '').trimEnd())
    .join('\n')
    .trim()
  return value || undefined
}

function unsupported(message: string): never {
  throw new UnsupportedTypeScriptTypeError(message)
}
