import type { SourceExpressionContext, SourceExpressionIR } from '@/domain/types/source/source-expression.types'

import { readPath, VALUE_EXPRESSION_OPERATIONS } from './value-expression-operations'

/** Вычисляет общий безопасный ValueExpression без eval/new Function. */
export function evaluateSourceExpression(
  expression: SourceExpressionIR,
  context: SourceExpressionContext = {},
): unknown {
  const evaluate = (node: SourceExpressionIR, current: unknown = context.current): unknown => {
    if (node.type === 'literal')
      return cloneValue(node.value)

    if (node.type === 'array')
      return node.items.map(item => evaluate(item, current))

    if (node.type === 'object')
      return Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, evaluate(value, current)]))

    if (node.type === 'read') {
      if (node.source === 'current')
        return readPath(current, node.path)
      if (node.source === 'scope')
        return readPath(context.scope, node.path)
      if (context.read)
        return context.read(node)
      const source = node.source === 'prop'
        ? context.props
        : node.source === 'value'
          ? context.values
          : node.source === 'row'
            ? context.row
            : node.source === 'response'
              ? context.response
              : node.source === 'store'
                ? context.stores
                : undefined
      return readPath(source, node.path)
    }

    const operation = VALUE_EXPRESSION_OPERATIONS[node.operation]
    return operation(node.arguments, {
      evaluate: (argument, nestedCurrent = current) => evaluate(argument, nestedCurrent),
      warn: warning => context.onWarning?.(warning),
    })
  }

  return evaluate(expression)
}

/** Публичный alias общего DSL для новых domain source compiler-ов. */
export const evaluateValueExpression = evaluateSourceExpression

function cloneValue<T>(value: T): T {
  if (value === undefined)
    return value
  try {
    return structuredClone(value)
  }
  catch {
    return value
  }
}
