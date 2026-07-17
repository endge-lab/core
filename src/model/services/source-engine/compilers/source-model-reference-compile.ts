import * as t from '@babel/types'

export type ParsedSourceModelReference
  = | { kind: 'external', identity: string }
    | { kind: 'inline', source: string, definition: t.CallExpression }

/** Читает canonical string identity или legacy wrapper model('identity'). */
export function readSourceModelIdentity(
  raw: t.CallExpression['arguments'][number] | undefined,
  referenceCall: string,
): string | null {
  if (!raw || !t.isExpression(raw))
    return null

  const expression = unwrapExpression(raw)
  if (t.isStringLiteral(expression))
    return expression.value.trim() ? expression.value : null

  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: referenceCall }))
    return null

  const identity = expression.arguments[0]
  return identity && t.isStringLiteral(identity) && identity.value.trim()
    ? identity.value
    : null
}

/** Нормализует shorthand, legacy external wrapper и inline define-call в общий reference contract. */
export function readSourceModelReference(
  raw: t.CallExpression['arguments'][number] | undefined,
  source: string,
  options: {
    referenceCall: string
    defineCall: string
  },
): ParsedSourceModelReference | null {
  const identity = readSourceModelIdentity(raw, options.referenceCall)
  if (identity)
    return { kind: 'external', identity }

  if (!raw || !t.isExpression(raw))
    return null
  const expression = unwrapExpression(raw)
  if (!t.isCallExpression(expression)
    || !t.isIdentifier(expression.callee, { name: options.defineCall })
    || expression.start == null
    || expression.end == null)
    return null

  return {
    kind: 'inline',
    source: source.slice(expression.start, expression.end),
    definition: expression,
  }
}

function unwrapExpression<T extends t.Expression>(node: T): t.Expression {
  let current: t.Expression = node
  while (t.isTSAsExpression(current) || t.isTSTypeAssertion(current) || t.isTSNonNullExpression(current) || t.isParenthesizedExpression(current))
    current = current.expression
  return current
}
