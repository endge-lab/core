import type { SourceDocumentReference, SourceLanguageContext } from '@/domain/types/source/source-engine.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { unwrapExpression } from '@/model/services/source-engine/compilers/source-expression-compile'
import { serializeTypeSourceReference } from '@/model/services/source-engine/type-source-serialize'

interface TypeSourceReferenceLocation extends SourceDocumentReference {
  normalizationRange: SourceDocumentReference['range']
}

/** Собирает ссылки на Type Registry из поддержанных Type Source выражений. */
export function collectTypeSourceReferences(source: string): TypeSourceReferenceLocation[] {
  try {
    const ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
      errorRecovery: true,
    })
    const references: TypeSourceReferenceLocation[] = []
    for (const statement of ast.program.body) {
      if (!t.isExpressionStatement(statement)) continue
      const expression = unwrapExpression(statement.expression)
      if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'defineType' })) continue
      const definition = expression.arguments[0]
      if (definition && t.isExpression(definition)) collectTypeExpression(definition, references)
    }
    return references
  }
  catch {
    return []
  }
}

/** Переводит ссылки на типы в канонический синтаксис без кавычек. */
export function normalizeTypeSourceReferences(source: string): string {
  return collectTypeSourceReferences(source)
    .map(reference => ({
      range: reference.normalizationRange,
      replacement: serializeTypeSourceReference(reference.identity),
    }))
    .filter(edit => source.slice(edit.range.start, edit.range.end) !== edit.replacement)
    .sort((left, right) => right.range.start - left.range.start)
    .reduce(
      (result, edit) => `${result.slice(0, edit.range.start)}${edit.replacement}${result.slice(edit.range.end)}`,
      source,
    )
}

/** Находит ссылку Type Source в позиции редактора. */
export function resolveTypeSourceReference(context: SourceLanguageContext): SourceDocumentReference | null {
  const offset = positionToOffset(context.source, context.position)
  if (offset == null) return null
  return collectTypeSourceReferences(context.source)
    .filter(reference => offset >= reference.range.start && offset < reference.range.end)
    .sort((left, right) => rangeLength(left) - rangeLength(right))[0] ?? null
}

function collectTypeExpression(raw: t.Expression, references: TypeSourceReferenceLocation[]): void {
  const node = unwrapExpression(raw)
  if (t.isIdentifier(node) || t.isStringLiteral(node)) {
    addReference(node, references)
    return
  }
  if (t.isObjectExpression(node)) {
    collectObjectFields(node, references)
    return
  }
  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee)) return

  if (node.callee.name === 'type') {
    const argument = node.arguments[0]
    if (argument && (t.isIdentifier(argument) || t.isStringLiteral(argument))) addReference(argument, references, node)
    return
  }
  if (node.callee.name === 'objectOf') {
    const argument = node.arguments[0]
    if (argument && t.isObjectExpression(argument)) collectObjectFields(argument, references)
    return
  }
  if (node.callee.name === 'unionOf') {
    for (const argument of node.arguments) {
      if (t.isExpression(argument)) collectTypeExpression(argument, references)
    }
    return
  }
  if (node.callee.name === 'arrayOf' || node.callee.name === 'recordOf') {
    const argument = node.arguments[0]
    if (argument && t.isExpression(argument)) collectTypeExpression(argument, references)
  }
}

function collectObjectFields(object: t.ObjectExpression, references: TypeSourceReferenceLocation[]): void {
  for (const property of object.properties) {
    if (!t.isObjectProperty(property) || !t.isExpression(property.value)) continue
    let cursor = unwrapExpression(property.value)
    while (t.isCallExpression(cursor) && t.isMemberExpression(cursor.callee) && t.isExpression(cursor.callee.object)) {
      cursor = unwrapExpression(cursor.callee.object)
    }
    if (!t.isCallExpression(cursor) || !t.isIdentifier(cursor.callee, { name: 'field' })) continue
    const argument = cursor.arguments[0]
    if (argument && t.isExpression(argument)) collectTypeExpression(argument, references)
  }
}

function addReference(
  node: t.Identifier | t.StringLiteral,
  references: TypeSourceReferenceLocation[],
  normalizationNode: t.Node = node,
): void {
  const identity = (t.isIdentifier(node) ? node.name : node.value).trim()
  if (!identity || node.start == null || node.end == null || normalizationNode.start == null || normalizationNode.end == null) return
  references.push({
    target: 'type',
    identity,
    range: { start: node.start, end: node.end },
    normalizationRange: { start: normalizationNode.start, end: normalizationNode.end },
  })
}

function positionToOffset(source: string, position: SourceLanguageContext['position']): number | null {
  if (!position) return null
  const lines = source.split('\n')
  const lineIndex = Math.max(0, Math.min(position.lineNumber - 1, lines.length - 1))
  let offset = 0
  for (let index = 0; index < lineIndex; index++) offset += (lines[index]?.length ?? 0) + 1
  const line = lines[lineIndex] ?? ''
  return offset + Math.max(0, Math.min(position.column - 1, line.length))
}

function rangeLength(reference: SourceDocumentReference): number {
  return reference.range.end - reference.range.start
}
