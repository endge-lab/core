import type { ComponentSFCExpressionIR as Expression } from '@/features/core/modules/domain/types/component/sfc/expression-ir.types'
import type { ComponentSFCRenderPort } from '@/features/core/modules/runtime/domain/component-sfc-render-port.types'

export interface SFCExpressionEvaluationContext {
  props: Record<string, unknown>
  locals: Record<string, unknown>
  context: object
  host: Pick<ComponentSFCRenderPort, 'translate' | 'resolveVocabOptions' | 'readDataMeta'> | null
  dataScope: { boundaryId: string, rowKey: unknown } | null
}

const UNSUPPORTED_EXPRESSION = Symbol('unsupported-sfc-expression')
const BLOCKED_MEMBER_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
type SFCExpressionResult = unknown | typeof UNSUPPORTED_EXPRESSION

/** Исполняет только готовый IR. Не читает source и не вызывает parser/compiler. */
export function evaluateComponentSFCExpression(expression: Expression, context: SFCExpressionEvaluationContext): unknown {
  const result = evaluate(expression, context)
  return result === UNSUPPORTED_EXPRESSION ? undefined : result
}

function evaluate(node: Expression, context: SFCExpressionEvaluationContext): SFCExpressionResult {
  const run = (value: Expression) => evaluate(value, context)
  switch (node.kind) {
    case 'literal': return node.value
    case 'unsupported': return UNSUPPORTED_EXPRESSION
    case 'read': {
      if (node.name === 'undefined') {
        return undefined
      }
      if (node.name === 'NaN') {
        return Number.NaN
      }
      if (node.name === 'Infinity') {
        return Number.POSITIVE_INFINITY
      }
      if (node.name === 'props') {
        return context.props
      }
      if (node.name === '$context') {
        return context.context
      }
      return Object.hasOwn(context.locals, node.name) ? context.locals[node.name] : context.props[node.name]
    }
    case 'unary': {
      const argument = run(node.argument)
      if (argument === UNSUPPORTED_EXPRESSION) {
        return argument
      }
      return unary(node.operator, argument)
    }
    case 'binary': {
      const left = run(node.left)
      const right = run(node.right)
      if (left === UNSUPPORTED_EXPRESSION || right === UNSUPPORTED_EXPRESSION) {
        return UNSUPPORTED_EXPRESSION
      }
      return binary(node.operator, left, right)
    }
    case 'logical': {
      const left = run(node.left)
      if (left === UNSUPPORTED_EXPRESSION) {
        return left
      }
      if (node.operator === '&&') {
        return left ? run(node.right) : left
      }
      if (node.operator === '||') {
        return left || run(node.right)
      }
      if (node.operator === '??') {
        return left ?? run(node.right)
      }
      return UNSUPPORTED_EXPRESSION
    }
    case 'conditional': {
      const test = run(node.test)
      return test === UNSUPPORTED_EXPRESSION ? test : run(test ? node.consequent : node.alternate)
    }
    case 'member': {
      const object = run(node.object)
      if (object === UNSUPPORTED_EXPRESSION) {
        return object
      }
      if (object == null) {
        return undefined
      }
      const property = node.computed ? run(node.property) : readName(node.property)
      return typeof property === 'string' || typeof property === 'number' ? readSafeMember(object, property) : UNSUPPORTED_EXPRESSION
    }
    case 'select': {
      const object = run(node.object)
      if (object === UNSUPPORTED_EXPRESSION) {
        return object
      }
      if (!Array.isArray(object)) {
        return undefined
      }
      const expected = run(node.value)
      if (expected === UNSUPPORTED_EXPRESSION || BLOCKED_MEMBER_KEYS.has(node.key)) {
        return UNSUPPORTED_EXPRESSION
      }
      return object.find(item => item != null && typeof item === 'object' && Object.hasOwn(item, node.key) && Object.is(item[node.key], expected))
    }
    case 'call': return call(node, context)
    case 'array': {
      const result = []
      for (const item of node.items) {
        const value = run(item)
        if (value === UNSUPPORTED_EXPRESSION) {
          return value
        }
        result.push(value)
      }
      return result
    }
    case 'object': {
      const result: Record<string, unknown> = {}
      for (const entry of node.entries) {
        if (BLOCKED_MEMBER_KEYS.has(entry.key)) {
          return UNSUPPORTED_EXPRESSION
        }
        const value = run(entry.value)
        if (value === UNSUPPORTED_EXPRESSION) {
          return value
        }
        result[entry.key] = value
      }
      return result
    }
    case 'template': {
      let result = ''
      for (let index = 0; index < node.parts.length; index++) {
        result += node.parts[index]
        const expression = node.expressions[index]
        if (!expression) {
          continue
        }
        const value = run(expression)
        if (value === UNSUPPORTED_EXPRESSION) {
          return value
        }
        result += String(value ?? '')
      }
      return result
    }
  }
}

function readName(node: Expression): string | typeof UNSUPPORTED_EXPRESSION {
  return node.kind === 'read' ? node.name : UNSUPPORTED_EXPRESSION
}

function call(node: Extract<Expression, { kind: 'call' }>, context: SFCExpressionEvaluationContext): SFCExpressionResult {
  const callee = node.callee
  if (callee.kind === 'member' && !callee.computed && readName(callee.object) === '$data' && readName(callee.property) === 'metaOf') {
    return readDataMeta(node.arguments, context)
  }
  const args = []
  for (const argument of node.arguments) {
    const value = evaluate(argument, context)
    if (value === UNSUPPORTED_EXPRESSION) {
      return value
    }
    args.push(value)
  }
  if (callee.kind === 'read') {
    return callSafeGlobal(callee.name, args, context)
  }
  if (callee.kind !== 'member') {
    return UNSUPPORTED_EXPRESSION
  }
  const method = callee.computed ? evaluate(callee.property, context) : readName(callee.property)
  if (typeof method !== 'string') {
    return UNSUPPORTED_EXPRESSION
  }
  const globalName = readName(callee.object)
  if (typeof globalName === 'string') {
    const result = callSafeStatic(globalName, method, args)
    if (result !== UNSUPPORTED_EXPRESSION) {
      return result
    }
  }
  const receiver = evaluate(callee.object, context)
  if (receiver === UNSUPPORTED_EXPRESSION) {
    return receiver
  }
  return receiver == null ? undefined : callSafeInstance(receiver, method, args)
}

function readStaticPath(node: Expression): string[] {
  if (node.kind === 'read') {
    return [node.name]
  }
  if (node.kind !== 'member') {
    return []
  }
  const parent = readStaticPath(node.object)
  const key = node.computed ? node.property.kind === 'literal' && typeof node.property.value === 'string' ? node.property.value : '' : readName(node.property)
  return parent.length && typeof key === 'string' && key ? [...parent, key] : []
}

function readDataMeta(args: Expression[], context: SFCExpressionEvaluationContext): unknown {
  if (!context.host || args.length < 1 || args.length > 2 || !args[0]) {
    return undefined
  }
  const path = readStaticPath(args[0])
  const namespace = args[1]?.kind === 'literal' && typeof args[1].value === 'string' ? args[1].value.trim() : undefined
  if (!path.length || (args[1] && !namespace)) {
    return undefined
  }
  if (path[0] === 'props') {
    path.shift()
  }
  const prop = path[0]
  if (prop && Object.hasOwn(context.props, prop)) {
    return context.host.readDataMeta({ kind: 'prop', prop, path: path.slice(1) }, namespace)
  }
  const rowPath = path[0] === 'row' ? path.slice(1) : path[0] === '$row' && path[1] === 'data' ? path.slice(2) : null
  if (rowPath === null || !context.dataScope) {
    return undefined
  }
  return context.host.readDataMeta({ kind: 'table-row', path: rowPath, boundaryId: context.dataScope.boundaryId, rowKey: context.dataScope.rowKey }, namespace)
}

function unary(operator: string, argument: unknown): SFCExpressionResult {
  switch (operator) {
    case '!':
      return !argument
    case '+':
      return +(argument as number)
    case '-':
      return -(argument as number)
    case '~':
      return ~(argument as number)
    case 'typeof':
      return typeof argument
    case 'void':
      return undefined
    default:
      return UNSUPPORTED_EXPRESSION
  }
}

function binary(operator: string, left: unknown, right: unknown): SFCExpressionResult {
  switch (operator) {
    case '===':
      return left === right
    case '!==':
      return left !== right
    case '==':
      return isLooselyEqual(left, right)
    case '!=':
      return !isLooselyEqual(left, right)
    case '<':
      return (left as number) < (right as number)
    case '<=':
      return (left as number) <= (right as number)
    case '>':
      return (left as number) > (right as number)
    case '>=':
      return (left as number) >= (right as number)
    case '+':
      return (left as number) + (right as number)
    case '-':
      return (left as number) - (right as number)
    case '*':
      return (left as number) * (right as number)
    case '/':
      return (left as number) / (right as number)
    case '%':
      return (left as number) % (right as number)
    case '**':
      return (left as number) ** (right as number)
    case '|':
      return (left as number) | (right as number)
    case '&':
      return (left as number) & (right as number)
    case '^':
      return (left as number) ^ (right as number)
    case '<<':
      return (left as number) << (right as number)
    case '>>':
      return (left as number) >> (right as number)
    case '>>>':
      return (left as number) >>> (right as number)
    default:
      return UNSUPPORTED_EXPRESSION
  }
}

function isLooselyEqual(left: unknown, right: unknown): boolean {
  // Поддерживаем JS expression semantics для авторского ==.
  // eslint-disable-next-line eqeqeq
  return left == right
}

function readSafeMember(object: unknown, property: string | number): SFCExpressionResult {
  const key = String(property)
  if (BLOCKED_MEMBER_KEYS.has(key)) {
    return UNSUPPORTED_EXPRESSION
  }

  if (typeof object === 'string') {
    if (key === 'length') {
      return object.length
    }
    const index = readArrayIndex(key)
    return index == null ? undefined : object[index]
  }

  if (Array.isArray(object)) {
    if (key === 'length') {
      return object.length
    }
    const index = readArrayIndex(key)
    return index == null ? undefined : object[index]
  }

  if (object === null || (typeof object !== 'object' && typeof object !== 'function')) {
    return undefined
  }
  if (!Object.hasOwn(object, key)) {
    return undefined
  }
  return (object as Record<string, unknown>)[key]
}

function readArrayIndex(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null
  }
  const index = Number(value)
  return Number.isSafeInteger(index) ? index : null
}

function callSafeGlobal(
  name: string | typeof UNSUPPORTED_EXPRESSION,
  args: unknown[],
  context: SFCExpressionEvaluationContext,
): SFCExpressionResult {
  if (name === UNSUPPORTED_EXPRESSION) {
    return name
  }
  if (name === 't') {
    if (typeof args[0] !== 'string' || args.length > 2) {
      return UNSUPPORTED_EXPRESSION
    }
    const fallback = args[1] == null ? undefined : String(args[1])
    return context.host?.translate(args[0], fallback) ?? fallback ?? `{{${args[0]}}}`
  }
  if (name === 'vocab') {
    if (
      typeof args[0] !== 'string'
      || args.length > 2
      || (
        args[1] != null
        && (typeof args[1] !== 'object' || Array.isArray(args[1]))
      )
    ) {
      return UNSUPPORTED_EXPRESSION
    }
    return context.host?.resolveVocabOptions(
      args[0],
      args[1] as { valuePath?: string, labelPath?: string } | undefined,
    ) ?? []
  }
  if (name === 'Boolean') {
    return Boolean(args[0])
  }
  if (name === 'Number') {
    return Number(args[0])
  }
  if (name === 'String') {
    return String(args[0] ?? '')
  }
  return UNSUPPORTED_EXPRESSION
}

function callSafeStatic(name: string, method: string, args: unknown[]): SFCExpressionResult {
  if (name === 'Array' && method === 'isArray') {
    return Array.isArray(args[0])
  }
  if (name === 'Number' && method === 'isFinite') {
    return Number.isFinite(args[0])
  }
  if (name === 'Number' && method === 'isNaN') {
    return Number.isNaN(args[0])
  }
  if (name === 'Object' && method === 'is') {
    return Object.is(args[0], args[1])
  }

  if (name !== 'Math') {
    return UNSUPPORTED_EXPRESSION
  }
  const numbers = args.map(value => Number(value))
  if (method === 'abs') {
    return Math.abs(numbers[0] ?? Number.NaN)
  }
  if (method === 'ceil') {
    return Math.ceil(numbers[0] ?? Number.NaN)
  }
  if (method === 'floor') {
    return Math.floor(numbers[0] ?? Number.NaN)
  }
  if (method === 'round') {
    return Math.round(numbers[0] ?? Number.NaN)
  }
  if (method === 'trunc') {
    return Math.trunc(numbers[0] ?? Number.NaN)
  }
  if (method === 'max') {
    return Math.max(...numbers)
  }
  if (method === 'min') {
    return Math.min(...numbers)
  }
  return UNSUPPORTED_EXPRESSION
}

function callSafeInstance(receiver: unknown, method: string, args: unknown[]): SFCExpressionResult {
  if (typeof receiver === 'string') {
    if (method === 'includes') {
      return receiver.includes(String(args[0] ?? ''), Number(args[1] ?? 0))
    }
    if (method === 'startsWith') {
      return receiver.startsWith(String(args[0] ?? ''), Number(args[1] ?? 0))
    }
    if (method === 'endsWith') {
      return receiver.endsWith(String(args[0] ?? ''), args[1] == null ? undefined : Number(args[1]))
    }
    if (method === 'toLowerCase') {
      return receiver.toLowerCase()
    }
    if (method === 'toUpperCase') {
      return receiver.toUpperCase()
    }
    if (method === 'trim') {
      return receiver.trim()
    }
  }

  if (Array.isArray(receiver) && method === 'includes') {
    return receiver.includes(args[0], Number(args[1] ?? 0))
  }

  return UNSUPPORTED_EXPRESSION
}
