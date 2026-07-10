import type { ProgramDiagnostic } from '@/domain/types/program.types'
import type {
  SourceExpressionIR,
  SourceExpressionOperation,
  SourceExpressionReadKind,
} from '@/domain/types/source-expression.types'

import * as t from '@babel/types'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

const READ_FUNCTIONS: Record<string, SourceExpressionReadKind> = {
  prop: 'prop',
  value: 'value',
  row: 'row',
  response: 'response',
  store: 'store',
}

const OPERATION_FUNCTIONS: Record<string, SourceExpressionOperation> = {
  merge: 'merge',
  compact: 'compact',
  and: 'and',
  between: 'between',
  inList: 'in-list',
  inArray: 'in-array',
  relativeDate: 'relative-date',
  relativeDateTime: 'relative-date-time',
}

const OPERATION_ARITY: Record<SourceExpressionOperation, { min: number, max?: number }> = {
  merge: { min: 2 },
  compact: { min: 1, max: 1 },
  and: { min: 1 },
  between: { min: 3, max: 3 },
  'in-list': { min: 1, max: 1 },
  'in-array': { min: 2, max: 2 },
  'relative-date': { min: 1, max: 1 },
  'relative-date-time': { min: 1, max: 2 },
}

/** Компилирует разрешенное source-expression в безопасный IR. */
export function compileSourceExpression(
  raw: t.Expression | null | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!raw) {
    diagnostics.push(diagnostic('error', 'source-expression-missing', 'Expression отсутствует.', sourcePath))
    return null
  }

  const node = unwrapExpression(raw)

  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node) || t.isNullLiteral(node)) {
    return { type: 'literal', value: literalValue(node) }
  }

  if (t.isIdentifier(node, { name: 'undefined' }))
    return { type: 'literal', value: undefined }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0)
    return { type: 'literal', value: node.quasis[0]?.value.cooked ?? '' }

  if (t.isArrayExpression(node)) {
    const items: SourceExpressionIR[] = []
    for (let index = 0; index < node.elements.length; index++) {
      const element = node.elements[index]
      if (!element || !t.isExpression(element)) {
        diagnostics.push(diagnostic('error', 'source-expression-array-item', 'Array допускает только expression items.', `${sourcePath}.${index}`))
        continue
      }
      const item = compileSourceExpression(element, diagnostics, `${sourcePath}.${index}`)
      if (item)
        items.push(item)
    }
    return { type: 'array', items }
  }

  if (t.isObjectExpression(node)) {
    const properties: Record<string, SourceExpressionIR> = {}
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'source-expression-object-property', 'Object допускает только обычные properties без spread/computed keys.', sourcePath, property))
        continue
      }
      const key = propertyName(property.key)
      if (!key) {
        diagnostics.push(diagnostic('error', 'source-expression-object-key', 'Не удалось определить имя object property.', sourcePath, property))
        continue
      }
      const value = compileSourceExpression(property.value, diagnostics, `${sourcePath}.${key}`)
      if (value)
        properties[key] = value
    }
    return { type: 'object', properties }
  }

  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const calleeName = node.callee.name
    const readSource = READ_FUNCTIONS[calleeName]
    if (readSource) {
      const path = readStringArgument(node, 0)
      if (path == null) {
        diagnostics.push(diagnostic('error', 'source-expression-read-path', `${node.callee.name}(...) принимает строковый path.`, sourcePath, node))
        return null
      }
      if (node.arguments.length !== 1)
        diagnostics.push(diagnostic('error', 'source-expression-read-arity', `${calleeName}(...) принимает ровно один path.`, sourcePath, node))
      return { type: 'read', source: readSource, path }
    }

    const operation = OPERATION_FUNCTIONS[calleeName]
    if (operation) {
      const arity = OPERATION_ARITY[operation]
      if (node.arguments.length < arity.min || (arity.max != null && node.arguments.length > arity.max)) {
        diagnostics.push(diagnostic(
          'error',
          'source-expression-operation-arity',
          `${calleeName}(...) получил недопустимое число arguments.`,
          sourcePath,
          node,
        ))
      }
      const args: SourceExpressionIR[] = []
      node.arguments.forEach((argument, index) => {
        if (!t.isExpression(argument)) {
          diagnostics.push(diagnostic('error', 'source-expression-operation-argument', `${calleeName}(...) не поддерживает spread arguments.`, `${sourcePath}.${index}`))
          return
        }
        const compiled = compileSourceExpression(argument, diagnostics, `${sourcePath}.${index}`)
        if (compiled)
          args.push(compiled)
      })
      return { type: 'operation', operation, arguments: args }
    }
  }

  diagnostics.push(diagnostic(
    'error',
    'source-expression-unsupported',
    'Expression не входит в безопасный whitelist source DSL.',
    sourcePath,
    node,
  ))
  return null
}

/** Извлекает expression-body из arrow/function callback и компилирует его в IR. */
export function compileSourceCallback(
  raw: t.CallExpression['arguments'][number] | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceExpressionIR | null {
  if (!raw || !t.isExpression(raw)) {
    diagnostics.push(diagnostic('error', 'source-callback-missing', 'Ожидается callback expression.', sourcePath))
    return null
  }

  const callback = unwrapExpression(raw)
  if (!t.isArrowFunctionExpression(callback) && !t.isFunctionExpression(callback)) {
    diagnostics.push(diagnostic('error', 'source-callback-shape', 'Ожидается arrow/function callback.', sourcePath, callback))
    return null
  }

  if (t.isBlockStatement(callback.body)) {
    diagnostics.push(diagnostic('error', 'source-callback-block-unsupported', 'Callback с block body не поддерживается; верните expression напрямую.', sourcePath, callback.body))
    return null
  }

  return compileSourceExpression(callback.body, diagnostics, sourcePath)
}

/** Снимает TS/parentheses wrappers с AST expression. */
export function unwrapExpression<T extends t.Node>(node: T): T {
  let current: t.Node = node
  while (
    t.isTSAsExpression(current)
    || t.isTSTypeAssertion(current)
    || t.isTSNonNullExpression(current)
    || t.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current as T
}

export function propertyName(node: t.Node): string | null {
  if (t.isIdentifier(node))
    return node.name
  if (t.isStringLiteral(node) || t.isNumericLiteral(node))
    return String(node.value)
  return null
}

export function readStringArgument(node: t.CallExpression, index: number): string | null {
  const argument = node.arguments[index]
  return argument && t.isStringLiteral(argument) ? argument.value : null
}

export function diagnostic(
  severity: DiagnosticDraft['severity'],
  code: string,
  message: string,
  sourcePath?: string,
  node?: t.Node | null,
): DiagnosticDraft {
  return {
    severity,
    code,
    message,
    sourcePath,
    start: typeof node?.start === 'number' ? node.start : undefined,
    end: typeof node?.end === 'number' ? node.end : undefined,
  }
}

function literalValue(node: t.StringLiteral | t.NumericLiteral | t.BooleanLiteral | t.NullLiteral): unknown {
  if (t.isNullLiteral(node))
    return null
  return node.value
}
