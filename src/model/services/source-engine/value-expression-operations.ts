import type { SourceExpressionIR, SourceExpressionOperation } from '@/domain/types/source-expression.types'

export interface ValueOperationRuntime {
  evaluate: (expression: SourceExpressionIR, current?: unknown) => unknown
}

export type ValueOperation = (
  args: SourceExpressionIR[],
  runtime: ValueOperationRuntime,
) => unknown

/** Единственный runtime-registry операций для Query, Composition и DataView. */
export const VALUE_EXPRESSION_OPERATIONS: Record<SourceExpressionOperation, ValueOperation> = {
  get: eager(args => readPath(args[0], String(args[1] ?? ''))),
  'get-or': eager(args => defaultTo(readPath(args[0], String(args[1] ?? '')), args[2])),
  has: eager(args => hasPath(args[0], String(args[1] ?? ''))),
  'default-to': eager(args => defaultTo(args[0], args[1])),
  pick: eager(args => pick(args[0], args[1])),
  omit: eager(args => omit(args[0], args[1])),
  merge: eager(args => args.reduce<Record<string, unknown>>((out, value) => deepMerge(out, asRecord(value)), {})),
  defaults: eager(args => args.slice(1).reduce<Record<string, unknown>>((out, value) => deepDefaults(out, asRecord(value)), cloneValue(asRecord(args[0])))),
  compact: eager(args => compact(args[0])),
  keys: eager(args => Object.keys(asRecord(args[0]))),
  values: eager(args => Object.values(asRecord(args[0]))),
  entries: eager(args => Object.entries(asRecord(args[0]))),
  map: collection((items, selector, runtime) => items.map((item, index) => runtime.evaluate(selector, indexed(item, index)))),
  where: collection((items, predicate, runtime) => items.filter((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  reject: collection((items, predicate, runtime) => items.filter((item, index) => !runtime.evaluate(predicate, indexed(item, index)))),
  find: collection((items, predicate, runtime) => items.find((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  some: collection((items, predicate, runtime) => items.some((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  every: collection((items, predicate, runtime) => items.every((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  'flat-map': collection((items, selector, runtime) => items.flatMap((item, index) => asArray(runtime.evaluate(selector, indexed(item, index))))),
  flatten: eager(args => asArray(args[0]).flat()),
  uniq: eager(args => unique(asArray(args[0]))),
  'uniq-by': collection((items, selector, runtime) => uniqueBy(items, item => runtime.evaluate(selector, item))),
  concat: eager(args => args.flatMap(asArray)),
  take: eager(args => asArray(args[0]).slice(0, Math.max(0, toCount(args[1], 1)))),
  drop: eager(args => asArray(args[0]).slice(Math.max(0, toCount(args[1], 1)))),
  'sort-by': collection((items, selector, runtime) => [...items].sort((left, right) => compare(runtime.evaluate(selector, left), runtime.evaluate(selector, right)))),
  'group-by': collection((items, selector, runtime) => groupBy(items, item => runtime.evaluate(selector, item))),
  'key-by': collection((items, selector, runtime) => keyBy(items, item => runtime.evaluate(selector, item))),
  size: eager(args => size(args[0])),
  sum: eager(args => asArray(args[0]).reduce<number>((total, value) => total + toNumber(value), 0)),
  'sum-by': collection((items, selector, runtime) => items.reduce<number>((total, item) => total + toNumber(runtime.evaluate(selector, item)), 0)),
  min: eager(args => extremum(asArray(args[0]), value => value, -1)),
  max: eager(args => extremum(asArray(args[0]), value => value, 1)),
  'min-by': collection((items, selector, runtime) => extremum(items, item => runtime.evaluate(selector, item), -1)),
  'max-by': collection((items, selector, runtime) => extremum(items, item => runtime.evaluate(selector, item), 1)),
  trim: eager(args => String(args[0] ?? '').trim()),
  'lower-case': eager(args => String(args[0] ?? '').toLowerCase()),
  'upper-case': eager(args => String(args[0] ?? '').toUpperCase()),
  split: eager(args => String(args[0] ?? '').split(String(args[1] ?? ''))),
  join: eager(args => asArray(args[0]).join(String(args[1] ?? ','))),
  match: eager(args => matches(args[0], args[1])),
  eq: eager(args => equal(args[0], args[1])),
  ne: eager(args => !equal(args[0], args[1])),
  gt: eager(args => compare(args[0], args[1]) > 0),
  gte: eager(args => compare(args[0], args[1]) >= 0),
  lt: eager(args => compare(args[0], args[1]) < 0),
  lte: eager(args => compare(args[0], args[1]) <= 0),
  includes: eager(args => includes(args[0], args[1])),
  and: eager(args => args.every(Boolean)),
  or: eager(args => args.some(Boolean)),
  not: eager(args => !args[0]),
  'is-nil': eager(args => args[0] == null),
  'is-empty': eager(args => isEmpty(args[0])),
  between: eager(args => between(args[0], args[1], args[2])),
  'in-list': eager(args => args.length === 2
    ? Array.isArray(args[1]) && args[1].some(item => equal(item, args[0]))
    : Array.isArray(args[0]) && args[0].length > 0 ? { in: args[0] } : undefined),
  'in-array': eager(args => !Array.isArray(args[1]) || args[1].length === 0 || args[1].includes(args[0])),
  'relative-date': eager(args => relativeDate(args[0])),
  'relative-date-time': eager(args => relativeDateTime(args[0], args[1])),
}

function eager(operation: (args: unknown[]) => unknown): ValueOperation {
  return (args, runtime) => operation(args.map(argument => runtime.evaluate(argument)))
}

function collection(operation: (items: unknown[], expression: SourceExpressionIR, runtime: ValueOperationRuntime) => unknown): ValueOperation {
  return (args, runtime) => operation(asArray(runtime.evaluate(args[0])), args[1], runtime)
}

export function readPath(source: unknown, path: string): unknown {
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

function hasPath(source: unknown, path: string): boolean {
  if (!path)
    return source !== undefined
  let current: any = source
  for (const part of path.split('.').filter(Boolean)) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part))
      return false
    current = current[part]
  }
  return true
}

function defaultTo(value: unknown, fallback: unknown): unknown {
  return value == null || (typeof value === 'number' && Number.isNaN(value)) ? fallback : value
}

function pick(value: unknown, keys: unknown): unknown {
  if (typeof keys === 'string')
    return readPath(value, keys)
  const source = asRecord(value)
  return asArray(keys).reduce<Record<string, unknown>>((out, key) => {
    const name = String(key)
    if (Object.prototype.hasOwnProperty.call(source, name))
      out[name] = source[name]
    return out
  }, {})
}

function omit(value: unknown, keys: unknown): Record<string, unknown> {
  const out = { ...asRecord(value) }
  for (const key of asArray(keys))
    delete out[String(key)]
  return out
}

function matches(value: unknown, criteria: unknown): boolean {
  const source = asRecord(value)
  return Object.entries(asRecord(criteria)).every(([key, expected]) => equal(readPath(source, key), expected))
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right))
    return true
  if ((Array.isArray(left) && Array.isArray(right)) || (isRecord(left) && isRecord(right)))
    return structuralKey(left) === structuralKey(right)
  return false
}

function includes(container: unknown, value: unknown): boolean {
  if (typeof container === 'string')
    return container.includes(String(value ?? ''))
  return Array.isArray(container) && container.some(item => equal(item, value))
}

function unique(items: unknown[]): unknown[] {
  return uniqueBy(items, item => item)
}

function uniqueBy(items: unknown[], selector: (item: unknown) => unknown): unknown[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = structuralKey(selector(item))
    if (seen.has(key))
      return false
    seen.add(key)
    return true
  })
}

function groupBy(items: unknown[], selector: (item: unknown) => unknown): Record<string, unknown[]> {
  return items.reduce<Record<string, unknown[]>>((out, item) => {
    const key = String(selector(item))
    ;(out[key] ??= []).push(item)
    return out
  }, {})
}

function keyBy(items: unknown[], selector: (item: unknown) => unknown): Record<string, unknown> {
  return items.reduce<Record<string, unknown>>((out, item) => {
    out[String(selector(item))] = item
    return out
  }, {})
}

function extremum(items: unknown[], selector: (item: unknown) => unknown, direction: -1 | 1): unknown {
  if (items.length === 0)
    return undefined
  return items.slice(1).reduce((best, item) => compare(selector(item), selector(best)) * direction > 0 ? item : best, items[0])
}

function compare(left: unknown, right: unknown): number {
  if (Object.is(left, right))
    return 0
  if (left == null)
    return 1
  if (right == null)
    return -1
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right))
}

function size(value: unknown): number {
  if (typeof value === 'string' || Array.isArray(value))
    return value.length
  return Object.keys(asRecord(value)).length
}

function isEmpty(value: unknown): boolean {
  return value == null || size(value) === 0
}

function between(value: unknown, from: unknown, to: unknown): boolean {
  return value != null && (from == null || compare(value, from) >= 0) && (to == null || compare(value, to) <= 0)
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override))
    out[key] = isRecord(out[key]) && isRecord(value) ? deepMerge(out[key] as Record<string, unknown>, value) : cloneValue(value)
  return out
}

function deepDefaults(base: Record<string, unknown>, fallback: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(fallback)) {
    if (out[key] == null)
      out[key] = cloneValue(value)
    else if (isRecord(out[key]) && isRecord(value))
      out[key] = deepDefaults(out[key] as Record<string, unknown>, value)
  }
  return out
}

function compact(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(compact).filter(item => item != null)
  if (!isRecord(value))
    return value
  return Object.entries(value).reduce<Record<string, unknown>>((out, [key, item]) => {
    const next = compact(item)
    if (next != null && (!Array.isArray(next) || next.length) && (!isRecord(next) || Object.keys(next).length))
      out[key] = next
    return out
  }, {})
}

function relativeDate(value: unknown): string {
  const input = String(value ?? '').trim()
  const match = /^([+-]?)(\d+)d$/.exec(input)
  if (!match)
    return input
  const date = new Date()
  date.setDate(date.getDate() + Number(match[2]) * (match[1] === '-' ? -1 : 1))
  return date.toISOString().slice(0, 10)
}

function relativeDateTime(value: unknown, mode: unknown): string {
  const input = String(value ?? '').trim()
  const match = /^([+-]?)(\d+)d$/.exec(input)
  if (!match)
    return input
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + Number(match[2]) * (match[1] === '-' ? -1 : 1))
  if (mode === 'startOfDay')
    date.setUTCHours(0, 0, 0, 0)
  else if (mode === 'endOfDay')
    date.setUTCHours(23, 59, 59, 999)
  return date.toISOString()
}

function indexed(value: unknown, index: number): unknown {
  return isRecord(value) ? { ...value, $index: index } : value
}

function toCount(value: unknown, fallback: number): number {
  const count = Number(value ?? fallback)
  return Number.isFinite(count) ? Math.trunc(count) : fallback
}

function toNumber(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : 0
}

function structuralKey(value: unknown): string {
  try {
    return JSON.stringify(normalize(value)) ?? String(value)
  }
  catch {
    return String(value)
  }
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(normalize)
  if (!isRecord(value))
    return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cloneValue<T>(value: T): T {
  try {
    return structuredClone(value)
  }
  catch {
    return value
  }
}
