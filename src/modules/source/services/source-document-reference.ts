import type {
  SourceDocumentReference,
  SourceDocumentReferenceTarget,
  SourceLanguageContext,
  SourceLanguageSemanticHighlight,
} from '@/modules/source/domain/types/source-engine.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

export interface SourceDocumentReferenceRules {
  functions?: Partial<Record<string, SourceDocumentReferenceTarget>>
  methods?: Partial<Record<string, SourceDocumentReferenceTarget>>
  properties?: Array<{
    property: string
    parentProperty?: string
    target: SourceDocumentReferenceTarget
  }>
}

interface LocatedSourceDocumentReference {
  reference: SourceDocumentReference
  identityRange: SourceDocumentReference['range']
}

/** Разрешает внешнюю document reference под курсором по AST и правилам DSL. */
export function resolveSourceDocumentReference(
  context: SourceLanguageContext,
  rules: SourceDocumentReferenceRules,
): SourceDocumentReference | null {
  const offset = positionToOffset(context.source, context.position)
  if (offset == null) {
    return null
  }

  return collectSourceDocumentReferences(context.source, rules)
    .filter(location => containsOffset(location.reference.range, offset))
    .sort((left, right) => rangeLength(left.reference) - rangeLength(right.reference))[0]
    ?.reference ?? null
}

/** Подсвечивает ссылки `field(Type)` на отдельные Type Source документы. */
export function typedSourceTypeReferenceHighlights(
  context: SourceLanguageContext,
): SourceLanguageSemanticHighlight[] {
  const references = collectSourceDocumentReferences(context.source, typedReferenceRules())
    .map(location => ({
      ...location.reference,
      range: location.identityRange,
    }))

  return typeReferenceHighlights(context, references)
}

/** Создаёт единый semantic highlight для разрешимых Type Source ссылок. */
export function typeReferenceHighlights(
  context: SourceLanguageContext,
  references: readonly SourceDocumentReference[],
): SourceLanguageSemanticHighlight[] {
  if (!context.typeSymbols) {
    return []
  }

  const symbols = new Map(context.typeSymbols.map(symbol => [symbol.identity, symbol]))
  return references.flatMap((reference) => {
    if (reference.identity === context.ownerIdentity) {
      return []
    }
    const symbol = symbols.get(reference.identity)
    if (symbol && symbol.category !== 'user') {
      return []
    }
    return [{
      kind: 'type-reference' as const,
      status: symbol ? 'resolved' as const : 'unresolved' as const,
      identity: reference.identity,
      range: reference.range,
    }]
  })
}

function collectSourceDocumentReferences(
  source: string,
  rules: SourceDocumentReferenceRules,
): LocatedSourceDocumentReference[] {
  try {
    const ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
      errorRecovery: true,
    })
    const matches: LocatedSourceDocumentReference[] = []
    visitNode(ast, (node, ancestors) => {
      const reference = t.isCallExpression(node)
        ? referenceFromCall(node, rules)
        : t.isObjectProperty(node)
          ? referenceFromProperty(node, ancestors, rules)
          : null
      if (reference) {
        matches.push(reference)
      }
    })

    return matches
  }
  catch {
    return []
  }
}

/**
 * Разрешает ссылки типизированного DSL-документа.
 *
 * `field(TypeIdentity)` является общим source-контрактом Type Registry,
 * поэтому каждый новый типизированный язык не должен регистрировать его отдельно.
 */
export function resolveTypedSourceDocumentReference(
  context: SourceLanguageContext,
  rules: SourceDocumentReferenceRules = {},
): SourceDocumentReference | null {
  return resolveSourceDocumentReference(context, typedReferenceRules(rules))
}

function typedReferenceRules(
  rules: SourceDocumentReferenceRules = {},
): SourceDocumentReferenceRules {
  return {
    ...rules,
    functions: {
      ...rules.functions,
      field: 'type',
    },
  }
}

function referenceFromProperty(
  property: t.ObjectProperty,
  ancestors: t.Node[],
  rules: SourceDocumentReferenceRules,
): LocatedSourceDocumentReference | null {
  if (property.computed || !t.isStringLiteral(property.value)) {
    return null
  }
  const propertyName = staticPropertyName(property.key)
  if (!propertyName || !property.value.value.trim()) {
    return null
  }
  const parentObject = ancestors.at(-1)
  const parentProperty = ancestors.at(-2)
  const parentPropertyName = t.isObjectExpression(parentObject) && t.isObjectProperty(parentProperty)
    ? staticPropertyName(parentProperty.key)
    : null
  const rule = rules.properties?.find(candidate =>
    candidate.property === propertyName
    && (candidate.parentProperty == null || candidate.parentProperty === parentPropertyName),
  )
  return rule ? createReference(rule.target, property.value.value, property.key, property.value, property.value) : null
}

function referenceFromCall(
  call: t.CallExpression,
  rules: SourceDocumentReferenceRules,
): LocatedSourceDocumentReference | null {
  const argument = call.arguments[0]
  if (!argument) {
    return null
  }

  if (t.isIdentifier(call.callee)) {
    const target = rules.functions?.[call.callee.name]
    return target ? createCallReference(target, argument, call.callee) : null
  }

  if (t.isMemberExpression(call.callee) && !call.callee.computed && t.isIdentifier(call.callee.property)) {
    const target = rules.methods?.[call.callee.property.name]
    return target ? createCallReference(target, argument, call.callee.property) : null
  }

  return null
}

function createCallReference(
  target: SourceDocumentReferenceTarget,
  argument: t.CallExpression['arguments'][number],
  callee: t.Node,
): LocatedSourceDocumentReference | null {
  if (t.isStringLiteral(argument) && argument.value.trim()) {
    return createReference(target, argument.value, callee, argument, argument)
  }
  if (target === 'type' && t.isIdentifier(argument) && argument.name.trim()) {
    return createReference(target, argument.name, callee, argument, argument)
  }
  return null
}

function createReference(
  target: SourceDocumentReferenceTarget,
  identity: string,
  startNode: t.Node,
  endNode: t.Node,
  identityNode: t.Node,
): LocatedSourceDocumentReference | null {
  if (startNode.start == null || endNode.end == null || identityNode.start == null || identityNode.end == null) {
    return null
  }
  return {
    reference: {
      target,
      identity,
      range: { start: startNode.start, end: endNode.end },
    },
    identityRange: { start: identityNode.start, end: identityNode.end },
  }
}

function visitNode(node: t.Node, visitor: (node: t.Node, ancestors: t.Node[]) => void, ancestors: t.Node[] = []): void {
  visitor(node, ancestors)
  for (const key of t.VISITOR_KEYS[node.type] ?? []) {
    const child = (node as unknown as Record<string, unknown>)[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isNode(item)) {
          visitNode(item, visitor, [...ancestors, node])
        }
      }
    }
    else if (isNode(child)) {
      visitNode(child, visitor, [...ancestors, node])
    }
  }
}

function staticPropertyName(node: t.Node): string | null {
  if (t.isIdentifier(node)) {
    return node.name
  }
  if (t.isStringLiteral(node)) {
    return node.value
  }
  return null
}

function isNode(value: unknown): value is t.Node {
  return value != null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
}

function positionToOffset(source: string, position: SourceLanguageContext['position']): number | null {
  if (!position) {
    return null
  }
  const lines = source.split('\n')
  const lineIndex = Math.max(0, Math.min(position.lineNumber - 1, lines.length - 1))
  let offset = 0
  for (let index = 0; index < lineIndex; index++) {
    offset += (lines[index]?.length ?? 0) + 1
  }
  const line = lines[lineIndex] ?? ''
  return offset + Math.max(0, Math.min(position.column - 1, line.length))
}

function containsOffset(range: SourceDocumentReference['range'], offset: number): boolean {
  return offset >= range.start && offset < range.end
}

function rangeLength(reference: SourceDocumentReference): number {
  return reference.range.end - reference.range.start
}
