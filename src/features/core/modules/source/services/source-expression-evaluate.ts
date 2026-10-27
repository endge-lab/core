import type { SourceExpressionContext, SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'

import { readPath, VALUE_EXPRESSION_OPERATIONS } from './value-expression-operations'
import { runWithValuePathScope } from './value-path'

// Вычисляет общий безопасный ValueExpression без eval/new Function.
export function evaluateSourceExpression(
  expression: SourceExpressionIR,
  context: SourceExpressionContext = {},
): unknown {
  const evaluationCache = new WeakMap<object, Map<string, unknown>>()

  const evaluate = (node: SourceExpressionIR, current: unknown = context.current): unknown => {
    if (node.type === 'literal') {
      return cloneValue(node.value)
    }

    if (node.type === 'array') {
      return node.items.map(item => evaluate(item, current))
    }

    if (node.type === 'object') {
      return Object.fromEntries(Object.entries(node.properties).map(([key, value]) => [key, evaluate(value, current)]))
    }

    if (node.type === 'read') {
      if (node.source === 'env') {
        return context.environment?.(node.path)
      }
      if (node.source === 'current') {
        return readPath(current, node.path)
      }
      if (node.source === 'scope') {
        return readPath(context.scope, node.path)
      }
      if (context.read) {
        return context.read(node)
      }
      const source = node.source === 'prop'
        ? context.props
        : node.source === 'value'
          ? context.values
          : node.source === 'row'
            ? context.row
            : node.source === 'response'
              ? context.response
              : node.source === 'graphql-errors'
                ? context.graphQLErrors ?? []
                : node.source === 'store'
                  ? context.stores
                  : undefined
      return readPath(source, node.path)
    }

    if (node.type === 'transform') {
      const input = evaluate(node.input, current)
      const options = node.options ? evaluate(node.options, current) : undefined
      if (!context.transform) {
        throw new Error(`ValueExpression transform is not available: ${node.transform}:${node.identity}.`)
      }
      return context.transform(node, input, options)
    }

    const operation = VALUE_EXPRESSION_OPERATIONS[node.operation]
    return operation(node.arguments, {
      evaluate: (argument, nestedCurrent = current) => evaluate(argument, nestedCurrent),
      memoize: (owner, key, create) => {
        let ownerCache = evaluationCache.get(owner)
        if (!ownerCache) {
          ownerCache = new Map()
          evaluationCache.set(owner, ownerCache)
        }
        if (!ownerCache.has(key)) {
          ownerCache.set(key, create())
        }
        return ownerCache.get(key) as ReturnType<typeof create>
      },
      warn: warning => context.onWarning?.(warning),
    })
  }

  // Переменные `$имя` в путях берутся из props выражения; предупреждение о пути — одно на вычисление.
  let warnedPaths: Set<string> | undefined
  return runWithValuePathScope({
    vars: context.props,
    warn: (issue) => {
      const key = `${issue.code}\u0000${issue.path}`
      warnedPaths ??= new Set()
      if (warnedPaths.has(key)) {
        return
      }
      warnedPaths.add(key)
      context.onWarning?.({ code: issue.code, message: issue.message, data: { path: issue.path } })
    },
  }, () => evaluate(expression))
}

// Публичный alias общего DSL для новых domain source compiler-ов.
export const evaluateValueExpression = evaluateSourceExpression

function cloneValue<T>(value: T): T {
  if (value === undefined) {
    return value
  }
  try {
    return structuredClone(value)
  }
  catch {
    return value
  }
}
