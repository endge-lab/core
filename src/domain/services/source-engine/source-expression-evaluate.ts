import type { SourceExpressionContext, SourceExpressionIR } from '@/domain/types/source-expression.types'

/** Вычисляет безопасный source expression без eval/new Function. */
export function evaluateSourceExpression(
  expression: SourceExpressionIR,
  context: SourceExpressionContext = {},
): unknown {
  if (expression.type === 'literal')
    return cloneValue(expression.value)

  if (expression.type === 'array')
    return expression.items.map(item => evaluateSourceExpression(item, context))

  if (expression.type === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(expression.properties))
      out[key] = evaluateSourceExpression(value, context)
    return out
  }

  if (expression.type === 'read') {
    const source = expression.source === 'prop'
      ? context.props
      : expression.source === 'value'
        ? context.values
        : expression.source === 'row'
          ? context.row
          : expression.source === 'response'
            ? context.response
            : context.stores
    return readPath(source, expression.path)
  }

  const args = expression.arguments.map(argument => evaluateSourceExpression(argument, context))
  switch (expression.operation) {
    case 'merge':
      return args.reduce<Record<string, unknown>>((out, value) => deepMerge(out, asRecord(value)), {})
    case 'compact':
      return compact(args[0])
    case 'and':
      return args.every(Boolean)
    case 'between':
      return between(args[0], args[1], args[2])
    case 'in-list':
      return Array.isArray(args[0]) && args[0].length > 0 ? { in: args[0] } : undefined
    case 'in-array':
      return !Array.isArray(args[1]) || args[1].length === 0 || args[1].includes(args[0])
    case 'relative-date':
      return relativeDate(args[0])
    case 'relative-date-time':
      return relativeDateTime(args[0], args[1])
  }
}

function readPath(source: unknown, path: string): unknown {
  if (!path)
    return source
  let current: any = source
  for (const part of path.split('.').filter(Boolean)) {
    if (current == null)
      return undefined
    current = current[part]
  }
  return current
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const previous = out[key]
    out[key] = isRecord(previous) && isRecord(value)
      ? deepMerge(previous, value)
      : cloneValue(value)
  }
  return out
}

function compact(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(compact).filter(item => item !== undefined && item !== null)
  if (!isRecord(value))
    return value

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    const next = compact(item)
    if (next === undefined || next === null)
      continue
    if (Array.isArray(next) && next.length === 0)
      continue
    if (isRecord(next) && Object.keys(next).length === 0)
      continue
    out[key] = next
  }
  return out
}

function between(value: unknown, from: unknown, to: unknown): boolean {
  if (value == null)
    return false
  if (from != null && String(value) < String(from))
    return false
  if (to != null && String(value) > String(to))
    return false
  return true
}

function relativeDate(value: unknown): string {
  const input = String(value ?? '').trim()
  const match = /^([+-]?)(\d+)d$/.exec(input)
  if (!match)
    return input

  const sign = match[1] === '-' ? -1 : 1
  const days = Number(match[2]) * sign
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function relativeDateTime(value: unknown, mode: unknown): string {
  const input = String(value ?? '').trim()
  const match = /^([+-]?)(\d+)d$/.exec(input)
  if (!match)
    return input

  const sign = match[1] === '-' ? -1 : 1
  const days = Number(match[2]) * sign
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)

  const normalizedMode = String(mode ?? 'now').trim()
  if (normalizedMode === 'startOfDay')
    date.setUTCHours(0, 0, 0, 0)
  else if (normalizedMode === 'endOfDay')
    date.setUTCHours(23, 59, 59, 999)

  return date.toISOString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

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
