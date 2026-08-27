import type { SourceExpressionIR, SourceExpressionOperation, SourceExpressionWarning } from '@/domain/types/source/source-expression.types'

export interface ValueOperationRuntime {
  evaluate: (expression: SourceExpressionIR, current?: unknown) => unknown
  memoize: <T>(owner: object, key: string, create: () => T) => T
  warn: (warning: SourceExpressionWarning) => void
}

type JoinType = 'left' | 'full'

interface JoinBuilder {
  kind: 'value-expression-join'
  type: JoinType
  left: unknown[]
  right: unknown[]
}

interface JoinKey {
  left: string
  right: string
}

interface JoinRow {
  left: unknown | null
  right: unknown | null
}

interface LookupBuilder {
  kind: 'value-expression-lookup'
  cardinality: 'one' | 'many'
  source: unknown[]
}

interface LookupKey {
  source: string
  target: string
}

interface LookupIndex {
  rowsByKey: Map<string, unknown[]>
  warnedKeys: Set<string>
}

export type ValueOperation = (
  args: SourceExpressionIR[],
  runtime: ValueOperationRuntime,
) => unknown

/** Единственный runtime-registry операций для Query, Composition и DataView. */
export const VALUE_EXPRESSION_OPERATIONS: Record<SourceExpressionOperation, ValueOperation> = {
  'get': eager(args => readPath(args[0], String(args[1] ?? ''))),
  'get-or': eager(args => defaultTo(readPath(args[0], String(args[1] ?? '')), args[2])),
  'has': eager(args => hasPath(args[0], String(args[1] ?? ''))),
  'default-to': eager(args => defaultTo(args[0], args[1])),
  'pick': eager(args => pick(args[0], args[1])),
  'omit': eager(args => omit(args[0], args[1])),
  'merge': eager(args => args.reduce<Record<string, unknown>>((out, value) => deepMerge(out, asRecord(value)), {})),
  'defaults': eager(args => args.slice(1).reduce<Record<string, unknown>>((out, value) => deepDefaults(out, asRecord(value)), cloneValue(asRecord(args[0])))),
  'compact': eager(args => compact(args[0])),
  'keys': eager(args => Object.keys(asRecord(args[0]))),
  'values': eager(args => Object.values(asRecord(args[0]))),
  'entries': eager(args => Object.entries(asRecord(args[0]))),
  'map': collection((items, selector, runtime) => items.map((item, index) => runtime.evaluate(selector, indexed(item, index)))),
  'where': collection((items, predicate, runtime) => items.filter((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  'reject': collection((items, predicate, runtime) => items.filter((item, index) => !runtime.evaluate(predicate, indexed(item, index)))),
  'find': collection((items, predicate, runtime) => items.find((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  'some': collection((items, predicate, runtime) => items.some((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  'every': collection((items, predicate, runtime) => items.every((item, index) => Boolean(runtime.evaluate(predicate, indexed(item, index))))),
  'flat-map': collection((items, selector, runtime) => items.flatMap((item, index) => asArray(runtime.evaluate(selector, indexed(item, index))))),
  'flatten': eager(args => asArray(args[0]).flat()),
  'uniq': eager(args => unique(asArray(args[0]))),
  'uniq-by': collection((items, selector, runtime) => uniqueBy(items, item => runtime.evaluate(selector, item))),
  'concat': eager(args => args.every(value => typeof value === 'string')
    ? args.join('')
    : args.flatMap(asArray)),
  'take': eager(args => asArray(args[0]).slice(0, Math.max(0, toCount(args[1], 1)))),
  'drop': eager(args => asArray(args[0]).slice(Math.max(0, toCount(args[1], 1)))),
  'sort-by': collection((items, selector, runtime) => [...items].sort((left, right) => compare(runtime.evaluate(selector, left), runtime.evaluate(selector, right)))),
  'group-by': collection((items, selector, runtime) => groupBy(items, item => runtime.evaluate(selector, item))),
  'key-by': collection((items, selector, runtime) => keyBy(items, item => runtime.evaluate(selector, item))),
  'size': eager(args => size(args[0])),
  'sum': eager(args => asArray(args[0]).reduce<number>((total, value) => total + toNumber(value), 0)),
  'sum-by': collection((items, selector, runtime) => items.reduce<number>((total, item) => total + toNumber(runtime.evaluate(selector, item)), 0)),
  'min': eager(args => extremum(asArray(args[0]), value => value, -1)),
  'max': eager(args => extremum(asArray(args[0]), value => value, 1)),
  'min-by': collection((items, selector, runtime) => extremum(items, item => runtime.evaluate(selector, item), -1)),
  'max-by': collection((items, selector, runtime) => extremum(items, item => runtime.evaluate(selector, item), 1)),
  'trim': eager(args => String(args[0] ?? '').trim()),
  'lower-case': eager(args => String(args[0] ?? '').toLowerCase()),
  'upper-case': eager(args => String(args[0] ?? '').toUpperCase()),
  'split': eager(args => String(args[0] ?? '').split(String(args[1] ?? ''))),
  'join': eager(args => asArray(args[0]).join(String(args[1] ?? ','))),
  'match': eager(args => matches(args[0], args[1])),
  'eq': eager(args => equal(args[0], args[1])),
  'ne': eager(args => !equal(args[0], args[1])),
  'gt': eager(args => compare(args[0], args[1]) > 0),
  'gte': eager(args => compare(args[0], args[1]) >= 0),
  'lt': eager(args => compare(args[0], args[1]) < 0),
  'lte': eager(args => compare(args[0], args[1]) <= 0),
  'includes': eager(args => includes(args[0], args[1])),
  'and': eager(args => args.every(Boolean)),
  'or': eager(args => args.some(Boolean)),
  'when': (args, runtime) => runtime.evaluate(args[0])
    ? runtime.evaluate(args[1])
    : runtime.evaluate(args[2]),
  'not': eager(args => !args[0]),
  'is-nil': eager(args => args[0] == null),
  'is-empty': eager(args => isEmpty(args[0])),
  'between': eager(args => between(args[0], args[1], args[2])),
  'in-list': eager(args => args.length === 2
    ? Array.isArray(args[1]) && args[1].some(item => equal(item, args[0]))
    : Array.isArray(args[0]) && args[0].length > 0 ? { in: args[0] } : undefined),
  'in-array': eager(args => !Array.isArray(args[1]) || args[1].length === 0 || args[1].includes(args[0])),
  'relative-date': eager(args => relativeDate(args[0])),
  'relative-date-time': eager(args => relativeDateTime(args[0], args[1])),
  'left-join': joinBuilder('left'),
  'full-join': joinBuilder('full'),
  'join-by': joinBy('all'),
  'join-by-any': joinBy('any'),
  'join-coalesce': joinCoalesce,
  'lookup-one': lookupBuilder('one'),
  'lookup-many': lookupBuilder('many'),
  enrich,
  'coalesce': eager(args => args.find(value => !isDefaultValue(value))),
  choose,
  'lookup-value': eager(args => lookupValue(args[0], args[1], args[2])),
  'to-string': eager(args => String(args[0] ?? '')),
  'to-number': eager(args => toFiniteNumber(args[0]) ?? args[1]),
  'to-boolean': eager(args => toBoolean(args[0]) ?? args[1]),
  'type-of': eager(args => valueType(args[0])),
  'is-string': eager(args => typeof args[0] === 'string'),
  'is-number': eager(args => typeof args[0] === 'number' && Number.isFinite(args[0])),
  'is-boolean': eager(args => typeof args[0] === 'boolean'),
  'is-array': eager(args => Array.isArray(args[0])),
  'is-object': eager(args => isRecord(args[0])),
  'is-date-time': eager(args => parseDateTime(args[0]) != null),
  'is-duration': eager(args => normalizeDuration(args[0]) != null),
  'add': eager(args => args.reduce<number>((total, value) => total + toNumber(value), 0)),
  'subtract': eager(args => toNumber(args[0]) - toNumber(args[1])),
  'multiply': eager(args => args.reduce<number>((total, value) => total * toNumber(value), 1)),
  'divide': eager(args => divide(args[0], args[1])),
  'modulo': eager(args => modulo(args[0], args[1])),
  'abs': eager(args => Math.abs(toNumber(args[0]))),
  'negate': eager(args => -toNumber(args[0])),
  'round': eager(args => round(args[0], args[1])),
  'floor': eager(args => Math.floor(toNumber(args[0]))),
  'ceil': eager(args => Math.ceil(toNumber(args[0]))),
  'clamp': eager(args => Math.min(toNumber(args[2]), Math.max(toNumber(args[1]), toNumber(args[0])))),
  'average': eager(args => average(asArray(args[0]))),
  'average-by': collection((items, selector, runtime) => average(items.map(item => runtime.evaluate(selector, item)))),
  'starts-with': eager(args => String(args[0] ?? '').startsWith(String(args[1] ?? ''))),
  'ends-with': eager(args => String(args[0] ?? '').endsWith(String(args[1] ?? ''))),
  'replace': eager(args => String(args[0] ?? '').replace(String(args[1] ?? ''), String(args[2] ?? ''))),
  'replace-all': eager(args => String(args[0] ?? '').replaceAll(String(args[1] ?? ''), String(args[2] ?? ''))),
  'slice': eager(args => slice(args[0], args[1], args[2])),
  'pad-start': eager(args => String(args[0] ?? '').padStart(toCount(args[1], 0), String(args[2] ?? ' '))),
  'pad-end': eager(args => String(args[0] ?? '').padEnd(toCount(args[1], 0), String(args[2] ?? ' '))),
  'normalize-whitespace': eager(args => String(args[0] ?? '').trim().replace(/\s+/g, ' ')),
  'set': eager(args => immutableSet(args[0], args[1], args[2])),
  'unset': eager(args => immutableUnset(args[0], args[1])),
  'rename': eager(args => immutableRename(args[0], args[1], args[2])),
  'get-key': eager(args => asRecord(args[0])[String(args[1] ?? '')]),
  'from-entries': eager(args => fromEntries(args[0])),
  'first': eager(args => asArray(args[0])[0]),
  'last': eager(args => asArray(args[0]).at(-1)),
  'at': eager(args => asArray(args[0]).at(toCount(args[1], 0))),
  'reverse': eager(args => [...asArray(args[0])].reverse()),
  'sort-by-desc': collection((items, selector, runtime) => [...items].sort((left, right) => compare(runtime.evaluate(selector, right), runtime.evaluate(selector, left)))),
  'order-by': orderBy,
  'chunk': eager(args => chunk(asArray(args[0]), args[1])),
  'union': eager(args => unique(args.flatMap(asArray))),
  'intersection': eager(args => intersection(asArray(args[0]), asArray(args[1]))),
  'difference': eager(args => difference(asArray(args[0]), asArray(args[1]))),
  'count-by': collection((items, selector, runtime) => countBy(items, item => runtime.evaluate(selector, item))),
  'date-time': eager(args => dateTime(args[0])),
  'duration': eager(args => duration(args[0])),
  'date-time-add': eager(args => dateTimeShift(args[0], args[1], 1)),
  'date-time-subtract': eager(args => dateTimeShift(args[0], args[1], -1)),
  'date-time-difference': eager(args => dateTimeDifference(args[0], args[1])),
  'date-time-start-of': eager(args => dateTimeBoundary(args[0], args[1], 'start')),
  'date-time-end-of': eager(args => dateTimeBoundary(args[0], args[1], 'end')),
  'date-time-part': eager(args => dateTimePart(args[0], args[1])),
  'duration-add': eager(args => durationFromMilliseconds(args.reduce<number>((total, value) => total + durationMilliseconds(value), 0))),
  'duration-subtract': eager(args => durationFromMilliseconds(durationMilliseconds(args[0]) - durationMilliseconds(args[1]))),
  'duration-total': eager(args => durationTotal(args[0], args[1])),
  'contains-all': eager(args => containsAll(args[0], args[1])),
  'contains-any': eager(args => containsAny(args[0], args[1])),
}

function eager(operation: (args: unknown[]) => unknown): ValueOperation {
  return (args, runtime) => operation(args.map(argument => runtime.evaluate(argument)))
}

function collection(operation: (items: unknown[], expression: SourceExpressionIR, runtime: ValueOperationRuntime) => unknown): ValueOperation {
  return (args, runtime) => operation(asArray(runtime.evaluate(args[0])), args[1], runtime)
}

/** Вычисляет только первую подходящую ветку вида `{ when, then }`. */
function choose(args: SourceExpressionIR[], runtime: ValueOperationRuntime): unknown {
  const branches = args[0]
  if (branches?.type !== 'array') {
    return runtime.evaluate(args[1])
  }

  for (const branch of branches.items) {
    if (branch.type !== 'object') {
      continue
    }
    const condition = branch.properties.when
    const value = branch.properties.then
    if (condition && value && Boolean(runtime.evaluate(condition))) {
      return runtime.evaluate(value)
    }
  }
  return runtime.evaluate(args[1])
}

/** Стабильная сортировка по последовательности `{ by, direction }`. */
function orderBy(args: SourceExpressionIR[], runtime: ValueOperationRuntime): unknown {
  const items = asArray(runtime.evaluate(args[0]))
  const descriptors = args[1]
  if (descriptors?.type !== 'array') {
    return [...items]
  }

  const criteria = descriptors.items.flatMap((descriptor) => {
    if (descriptor.type !== 'object' || !descriptor.properties.by) {
      return []
    }
    return [{
      selector: descriptor.properties.by,
      direction: descriptor.properties.direction,
    }]
  })

  return items
    .map((value, index) => ({ value, index }))
    .sort((left, right) => {
      for (const criterion of criteria) {
        const direction = criterion.direction
          ? String(runtime.evaluate(criterion.direction)).toLowerCase()
          : 'asc'
        const result = compare(
          runtime.evaluate(criterion.selector, left.value),
          runtime.evaluate(criterion.selector, right.value),
        )
        if (result !== 0) {
          return direction === 'desc' ? -result : result
        }
      }
      return left.index - right.index
    })
    .map(item => item.value)
}

const resolveJoinSource = resolveCollectionSource

/** Создаёт отложенное описание join до объявления matching keys. */
function joinBuilder(type: JoinType): ValueOperation {
  return (args, runtime) => ({
    kind: 'value-expression-join',
    type,
    left: resolveJoinSource(args[0], runtime),
    right: resolveJoinSource(args[1], runtime),
  }) satisfies JoinBuilder
}

/** Создаёт отложенный lookup, который будет проиндексирован после .by(...). */
function lookupBuilder(cardinality: LookupBuilder['cardinality']): ValueOperation {
  return (args, runtime) => ({
    kind: 'value-expression-lookup',
    cardinality,
    source: resolveCollectionSource(args[0], runtime),
  }) satisfies LookupBuilder
}

/** Выполняет join по одному composite key или набору альтернативных keys. */
function joinBy(mode: 'all' | 'any'): ValueOperation {
  return (args, runtime) => {
    const builder = runtime.evaluate(args[0])
    if (isLookupBuilder(builder)) {
      return executeLookup(builder, args[1], runtime)
    }
    if (!isJoinBuilder(builder)) {
      return []
    }

    const keys = args.slice(1)
      .map(argument => normalizeJoinKey(runtime.evaluate(argument)))
      .filter((key): key is JoinKey => key != null)
    if (!keys.length) {
      return []
    }

    return executeJoin(builder, keys, mode, runtime)
  }
}

/** Дополняет вложенную object-ветку вычисленными полями, не меняя source rows. */
function enrich(args: SourceExpressionIR[], runtime: ValueOperationRuntime): unknown {
  const rows = runtime.evaluate(args[0])
  const branchPath = String(runtime.evaluate(args[1]) ?? '').trim()
  if (!Array.isArray(rows) || !branchPath) {
    return []
  }

  return rows.map((row) => {
    if (!isRecord(row)) {
      return cloneValue(row)
    }

    const branch = readPath(row, branchPath)
    if (!isRecord(branch)) {
      return cloneValue(row)
    }

    const fields = runtime.evaluate(args[2], branch)
    if (!isRecord(fields)) {
      return cloneValue(row)
    }

    return setPath(cloneValue(row), branchPath, deepMerge(branch, fields))
  })
}

function executeLookup(
  builder: LookupBuilder,
  keyExpression: SourceExpressionIR | undefined,
  runtime: ValueOperationRuntime,
): unknown {
  if (!keyExpression) {
    return builder.cardinality === 'many' ? [] : undefined
  }

  const key = normalizeLookupKey(runtime.evaluate(keyExpression))
  if (!key) {
    return builder.cardinality === 'many' ? [] : undefined
  }

  const targetValue = runtime.evaluate({ type: 'read', source: 'current', path: key.target })
  if (targetValue == null) {
    return builder.cardinality === 'many' ? [] : undefined
  }

  const index = runtime.memoize(builder.source, `lookup:${key.source}`, () => buildLookupIndex(builder.source, key.source))
  const encodedTarget = structuralKey(targetValue)
  const matches = index.rowsByKey.get(encodedTarget) ?? []

  if (builder.cardinality === 'many') {
    return matches
  }

  if (matches.length > 1 && !index.warnedKeys.has(encodedTarget)) {
    index.warnedKeys.add(encodedTarget)
    runtime.warn({
      code: 'value-expression-lookup-ambiguous',
      message: `lookupOne matched ${matches.length} records for the same key.`,
      data: { key, targetValue, matches: matches.length },
    })
  }
  return matches[0]
}

function buildLookupIndex(source: unknown[], sourcePath: string): LookupIndex {
  const rowsByKey = new Map<string, unknown[]>()
  for (const row of source) {
    const value = readPath(row, sourcePath)
    if (value == null) {
      continue
    }
    const key = structuralKey(value)
    const rows = rowsByKey.get(key) ?? []
    rows.push(row)
    rowsByKey.set(key, rows)
  }
  return { rowsByKey, warnedKeys: new Set() }
}

/** Объединяет left/right records, заполняя отсутствующие поля по приоритету. */
function joinCoalesce(args: SourceExpressionIR[], runtime: ValueOperationRuntime): unknown {
  const rows = runtime.evaluate(args[0])
  if (!Array.isArray(rows)) {
    return []
  }

  const options = args[1] ? runtime.evaluate(args[1]) : undefined
  const prefer = isRecord(options) && options.prefer === 'right' ? 'right' : 'left'

  return rows.map((value) => {
    const row = isRecord(value) ? value as unknown as JoinRow : { left: null, right: null }
    const primary = prefer === 'right' ? row.right : row.left
    const fallback = prefer === 'right' ? row.left : row.right

    if (!isRecord(primary)) {
      return cloneValue(fallback)
    }
    if (!isRecord(fallback)) {
      return cloneValue(primary)
    }
    return deepDefaults(primary, fallback)
  })
}

function resolveCollectionSource(expression: SourceExpressionIR, runtime: ValueOperationRuntime): unknown[] {
  const value = runtime.evaluate(expression)
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return []
  }

  const resolved = runtime.evaluate({ type: 'read', source: 'scope', path: value })
  return Array.isArray(resolved) ? resolved : []
}
function normalizeJoinKey(value: unknown): JoinKey | null {
  if (typeof value === 'string' && value.trim()) {
    return { left: value.trim(), right: value.trim() }
  }
  if (!isRecord(value)) {
    return null
  }
  const left = typeof value.left === 'string' ? value.left.trim() : ''
  const right = typeof value.right === 'string' ? value.right.trim() : ''
  return left && right ? { left, right } : null
}

function normalizeLookupKey(value: unknown): LookupKey | null {
  if (typeof value === 'string' && value.trim()) {
    return { source: value.trim(), target: 'id' }
  }
  if (!isRecord(value)) {
    return null
  }
  const source = typeof value.source === 'string' ? value.source.trim() : ''
  const target = typeof value.target === 'string' ? value.target.trim() : ''
  return source && target ? { source, target } : null
}

function executeJoin(
  builder: JoinBuilder,
  keys: JoinKey[],
  mode: 'all' | 'any',
  runtime: ValueOperationRuntime,
): JoinRow[] {
  const rows: JoinRow[] = []
  const matchedRight = new Set<number>()

  for (const left of builder.left) {
    const matches: number[] = []
    for (let index = 0; index < builder.right.length; index++) {
      if (joinRecordsMatch(left, builder.right[index], keys, mode)) {
        matches.push(index)
      }
    }

    if (matches.length > 1) {
      runtime.warn({
        code: 'value-expression-join-ambiguous',
        message: `Join record matched ${matches.length} records from the right collection.`,
        data: { left, matchIndexes: matches, keys },
      })
    }

    if (!matches.length) {
      rows.push({ left, right: null })
      continue
    }

    for (const index of matches) {
      matchedRight.add(index)
      rows.push({ left, right: builder.right[index] ?? null })
    }
  }

  if (builder.type === 'full') {
    for (let index = 0; index < builder.right.length; index++) {
      if (!matchedRight.has(index)) {
        rows.push({ left: null, right: builder.right[index] ?? null })
      }
    }
  }

  return rows
}

function joinRecordsMatch(left: unknown, right: unknown, keys: JoinKey[], mode: 'all' | 'any'): boolean {
  const matches = keys.map((key) => {
    const leftValue = readPath(left, key.left)
    const rightValue = readPath(right, key.right)
    return leftValue != null && rightValue != null && equal(leftValue, rightValue)
  })
  return mode === 'any' ? matches.some(Boolean) : matches.every(Boolean)
}

function isJoinBuilder(value: unknown): value is JoinBuilder {
  return isRecord(value)
    && value.kind === 'value-expression-join'
    && (value.type === 'left' || value.type === 'full')
    && Array.isArray(value.left)
    && Array.isArray(value.right)
}

function isLookupBuilder(value: unknown): value is LookupBuilder {
  return isRecord(value)
    && value.kind === 'value-expression-lookup'
    && (value.cardinality === 'one' || value.cardinality === 'many')
    && Array.isArray(value.source)
}

export function readPath(source: unknown, path: string): unknown {
  if (!path) {
    return source
  }
  let current: any = source
  for (const part of path.split('.').filter(Boolean)) {
    if (current == null) {
      return undefined
    }
    current = current[part]
  }
  return current
}

function setPath(source: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const parts = path.split('.').filter(Boolean)
  if (!parts.length) {
    return source
  }

  let current = source
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index]!
    const next = current[part]
    current[part] = isRecord(next) ? next : {}
    current = current[part] as Record<string, unknown>
  }
  current[parts.at(-1)!] = cloneValue(value)
  return source
}

function hasPath(source: unknown, path: string): boolean {
  if (!path) {
    return source !== undefined
  }
  let current: any = source
  for (const part of path.split('.').filter(Boolean)) {
    if (current == null || !Object.hasOwn(new Object(current), part)) {
      return false
    }
    current = current[part]
  }
  return true
}

function defaultTo(value: unknown, fallback: unknown): unknown {
  return value == null || (typeof value === 'number' && Number.isNaN(value)) ? fallback : value
}

function isDefaultValue(value: unknown): boolean {
  return value == null || (typeof value === 'number' && Number.isNaN(value))
}

function pick(value: unknown, keys: unknown): unknown {
  if (typeof keys === 'string') {
    return readPath(value, keys)
  }
  const source = asRecord(value)
  return asArray(keys).reduce<Record<string, unknown>>((out, key) => {
    const name = String(key)
    if (Object.hasOwn(source, name)) {
      out[name] = source[name]
    }
    return out
  }, {})
}

function omit(value: unknown, keys: unknown): Record<string, unknown> {
  const out = { ...asRecord(value) }
  for (const key of asArray(keys)) {
    delete out[String(key)]
  }
  return out
}

function matches(value: unknown, criteria: unknown): boolean {
  const source = asRecord(value)
  return Object.entries(asRecord(criteria)).every(([key, expected]) => equal(readPath(source, key), expected))
}

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  if ((Array.isArray(left) && Array.isArray(right)) || (isRecord(left) && isRecord(right))) {
    return structuralKey(left) === structuralKey(right)
  }
  return false
}

function includes(container: unknown, value: unknown): boolean {
  if (typeof container === 'string') {
    return container.includes(String(value ?? ''))
  }
  return Array.isArray(container) && container.some(item => equal(item, value))
}

function containsAll(container: unknown, values: unknown): boolean {
  const items = asArray(values)
  return items.every(value => includes(container, value))
}

function containsAny(container: unknown, values: unknown): boolean {
  return asArray(values).some(value => includes(container, value))
}

function unique(items: unknown[]): unknown[] {
  return uniqueBy(items, item => item)
}

function uniqueBy(items: unknown[], selector: (item: unknown) => unknown): unknown[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = structuralKey(selector(item))
    if (seen.has(key)) {
      return false
    }
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

function countBy(items: unknown[], selector: (item: unknown) => unknown): Record<string, number> {
  return items.reduce<Record<string, number>>((out, item) => {
    const key = String(selector(item))
    out[key] = (out[key] ?? 0) + 1
    return out
  }, {})
}

function extremum(items: unknown[], selector: (item: unknown) => unknown, direction: -1 | 1): unknown {
  if (items.length === 0) {
    return undefined
  }
  return items.slice(1).reduce((best, item) => compare(selector(item), selector(best)) * direction > 0 ? item : best, items[0])
}

function compare(left: unknown, right: unknown): number {
  if (Object.is(left, right)) {
    return 0
  }
  if (left == null) {
    return 1
  }
  if (right == null) {
    return -1
  }
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right))
}

function size(value: unknown): number {
  if (typeof value === 'string' || Array.isArray(value)) {
    return value.length
  }
  return Object.keys(asRecord(value)).length
}

function isEmpty(value: unknown): boolean {
  return value == null || size(value) === 0
}

function between(value: unknown, from: unknown, to: unknown): boolean {
  return value != null && (from == null || compare(value, from) >= 0) && (to == null || compare(value, to) <= 0)
}

function lookupValue(value: unknown, dictionary: unknown, fallback: unknown): unknown {
  const source = asRecord(dictionary)
  const key = String(value ?? '')
  return Object.hasOwn(source, key) ? source[key] : fallback
}

function valueType(value: unknown): string {
  if (value == null) {
    return value === null ? 'null' : 'undefined'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  if (normalizeDuration(value)) {
    return 'duration'
  }
  if (value instanceof Date) {
    return 'date-time'
  }
  return typeof value === 'object' ? 'object' : typeof value
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'string' && !value.trim()) {
    return undefined
  }
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value !== 0
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const normalized = value.trim().toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['false', '0', 'no', 'off', ''].includes(normalized)) {
    return false
  }
  return undefined
}

function divide(left: unknown, right: unknown): number | undefined {
  const denominator = toNumber(right)
  return denominator === 0 ? undefined : toNumber(left) / denominator
}

function modulo(left: unknown, right: unknown): number | undefined {
  const denominator = toNumber(right)
  return denominator === 0 ? undefined : toNumber(left) % denominator
}

function round(value: unknown, precision: unknown): number {
  const digits = Math.max(0, Math.trunc(toNumber(precision)))
  const factor = 10 ** digits
  return Math.round(toNumber(value) * factor) / factor
}

function average(values: unknown[]): number | undefined {
  if (!values.length) {
    return undefined
  }
  return values.reduce<number>((total, value) => total + toNumber(value), 0) / values.length
}

function slice(value: unknown, start: unknown, end: unknown): unknown {
  const from = toCount(start, 0)
  const to = end == null ? undefined : toCount(end, 0)
  return Array.isArray(value)
    ? value.slice(from, to)
    : String(value ?? '').slice(from, to)
}

function immutableSet(value: unknown, path: unknown, next: unknown): Record<string, unknown> {
  return setPath(cloneValue(asRecord(value)), String(path ?? ''), next)
}

function immutableUnset(value: unknown, path: unknown): Record<string, unknown> {
  const out = cloneValue(asRecord(value))
  const parts = String(path ?? '').split('.').filter(Boolean)
  if (!parts.length) {
    return out
  }
  const parent = parts.slice(0, -1).reduce<unknown>((current, part) => readPath(current, part), out)
  if (isRecord(parent)) {
    delete parent[parts.at(-1)!]
  }
  return out
}

function immutableRename(value: unknown, from: unknown, to: unknown): Record<string, unknown> {
  const sourcePath = String(from ?? '')
  const targetPath = String(to ?? '')
  if (!hasPath(value, sourcePath) || !targetPath) {
    return cloneValue(asRecord(value))
  }
  return immutableSet(immutableUnset(value, sourcePath), targetPath, readPath(value, sourcePath))
}

function fromEntries(value: unknown): Record<string, unknown> {
  const entries = asArray(value).filter((entry): entry is unknown[] => Array.isArray(entry) && entry.length >= 2)
  return Object.fromEntries(entries.map(entry => [String(entry[0]), entry[1]]))
}

function chunk(items: unknown[], sizeValue: unknown): unknown[][] {
  const chunkSize = Math.max(1, toCount(sizeValue, 1))
  const result: unknown[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    result.push(items.slice(index, index + chunkSize))
  }
  return result
}

function intersection(left: unknown[], right: unknown[]): unknown[] {
  return unique(left.filter(value => right.some(candidate => equal(candidate, value))))
}

function difference(left: unknown[], right: unknown[]): unknown[] {
  return left.filter(value => !right.some(candidate => equal(candidate, value)))
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value == null ? [] : [value]
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function deepMerge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    out[key] = isRecord(out[key]) && isRecord(value) ? deepMerge(out[key] as Record<string, unknown>, value) : cloneValue(value)
  }
  return out
}

function deepDefaults(base: Record<string, unknown>, fallback: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(fallback)) {
    if (out[key] == null) {
      out[key] = cloneValue(value)
    }
    else if (isRecord(out[key]) && isRecord(value)) {
      out[key] = deepDefaults(out[key] as Record<string, unknown>, value)
    }
  }
  return out
}

function compact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(compact).filter(item => item != null)
  }
  if (!isRecord(value)) {
    return value
  }
  return Object.entries(value).reduce<Record<string, unknown>>((out, [key, item]) => {
    const next = compact(item)
    if (next != null && (!Array.isArray(next) || next.length) && (!isRecord(next) || Object.keys(next).length)) {
      out[key] = next
    }
    return out
  }, {})
}

interface ValueDuration {
  kind: 'duration'
  milliseconds: number
}

const DURATION_UNITS = {
  milliseconds: 1,
  seconds: 1_000,
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
  weeks: 604_800_000,
} as const

type DurationUnit = keyof typeof DURATION_UNITS
type DateTimeUnit = 'year' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second'

function duration(value: unknown): ValueDuration | undefined {
  const milliseconds = durationMillisecondsOrUndefined(value)
  return milliseconds == null ? undefined : durationFromMilliseconds(milliseconds)
}

function normalizeDuration(value: unknown): ValueDuration | null {
  const milliseconds = durationMillisecondsOrUndefined(value)
  return milliseconds == null ? null : durationFromMilliseconds(milliseconds)
}

function durationMilliseconds(value: unknown): number {
  return durationMillisecondsOrUndefined(value) ?? 0
}

function durationMillisecondsOrUndefined(value: unknown): number | undefined {
  if (isRecord(value) && value.kind === 'duration') {
    return toFiniteNumber(value.milliseconds)
  }
  if (!isRecord(value)) {
    return undefined
  }

  let total = 0
  let recognized = false
  for (const [unit, factor] of Object.entries(DURATION_UNITS) as [DurationUnit, number][]) {
    if (!Object.hasOwn(value, unit)) {
      continue
    }
    const amount = toFiniteNumber(value[unit])
    if (amount == null) {
      return undefined
    }
    total += amount * factor
    recognized = true
  }
  return recognized ? total : undefined
}

function durationFromMilliseconds(milliseconds: number): ValueDuration {
  return { kind: 'duration', milliseconds }
}

function durationTotal(value: unknown, unitValue: unknown): number | undefined {
  const unit = String(unitValue ?? '') as DurationUnit
  const factor = DURATION_UNITS[unit]
  return factor ? durationMilliseconds(value) / factor : undefined
}

function parseDateTime(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(value.getTime())
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }
  if (typeof value === 'string' && !value.trim()) {
    return null
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function dateTime(value: unknown): string | undefined {
  return parseDateTime(value)?.toISOString()
}

function dateTimeShift(value: unknown, offset: unknown, direction: 1 | -1): string | undefined {
  const date = parseDateTime(value)
  const milliseconds = durationMillisecondsOrUndefined(offset)
  if (!date || milliseconds == null) {
    return undefined
  }
  return new Date(date.getTime() + milliseconds * direction).toISOString()
}

function dateTimeDifference(left: unknown, right: unknown): ValueDuration | undefined {
  const leftDate = parseDateTime(left)
  const rightDate = parseDateTime(right)
  return leftDate && rightDate
    ? durationFromMilliseconds(leftDate.getTime() - rightDate.getTime())
    : undefined
}

function dateTimeBoundary(value: unknown, unitValue: unknown, boundary: 'start' | 'end'): string | undefined {
  const date = parseDateTime(value)
  const unit = String(unitValue ?? '') as DateTimeUnit
  if (!date || !['year', 'month', 'week', 'day', 'hour', 'minute', 'second'].includes(unit)) {
    return undefined
  }

  if (boundary === 'start') {
    if (unit === 'year') {
      date.setUTCMonth(0, 1)
    }
    if (unit === 'year' || unit === 'month') {
      date.setUTCDate(1)
    }
    if (unit === 'week') {
      date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    }
    if (['year', 'month', 'week', 'day'].includes(unit)) {
      date.setUTCHours(0, 0, 0, 0)
    }
    else if (unit === 'hour') {
      date.setUTCMinutes(0, 0, 0)
    }
    else if (unit === 'minute') {
      date.setUTCSeconds(0, 0)
    }
    else { date.setUTCMilliseconds(0) }
    return date.toISOString()
  }

  const start = dateTimeBoundary(date, unit, 'start')
  const startDate = start ? new Date(start) : null
  if (!startDate) {
    return undefined
  }
  if (unit === 'year') {
    startDate.setUTCFullYear(startDate.getUTCFullYear() + 1)
  }
  else if (unit === 'month') {
    startDate.setUTCMonth(startDate.getUTCMonth() + 1)
  }
  else if (unit === 'week') {
    startDate.setUTCDate(startDate.getUTCDate() + 7)
  }
  else if (unit === 'day') {
    startDate.setUTCDate(startDate.getUTCDate() + 1)
  }
  else if (unit === 'hour') {
    startDate.setUTCHours(startDate.getUTCHours() + 1)
  }
  else if (unit === 'minute') {
    startDate.setUTCMinutes(startDate.getUTCMinutes() + 1)
  }
  else { startDate.setUTCSeconds(startDate.getUTCSeconds() + 1) }
  return new Date(startDate.getTime() - 1).toISOString()
}

function dateTimePart(value: unknown, partValue: unknown): number | undefined {
  const date = parseDateTime(value)
  if (!date) {
    return undefined
  }
  const parts: Record<string, () => number> = {
    year: () => date.getUTCFullYear(),
    month: () => date.getUTCMonth() + 1,
    day: () => date.getUTCDate(),
    weekday: () => date.getUTCDay() || 7,
    hour: () => date.getUTCHours(),
    minute: () => date.getUTCMinutes(),
    second: () => date.getUTCSeconds(),
    millisecond: () => date.getUTCMilliseconds(),
    timestamp: () => date.getTime(),
  }
  return parts[String(partValue ?? '')]?.()
}

function relativeDate(value: unknown): string {
  const input = String(value ?? '').trim()
  const match = /^([+-]?)(\d+)d$/.exec(input)
  if (!match) {
    return input
  }
  const date = new Date()
  date.setDate(date.getDate() + Number(match[2]) * (match[1] === '-' ? -1 : 1))
  return date.toISOString().slice(0, 10)
}

function relativeDateTime(value: unknown, mode: unknown): string {
  const input = String(value ?? '').trim()
  const match = /^([+-]?)(\d+)d$/.exec(input)
  if (!match) {
    return input
  }
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + Number(match[2]) * (match[1] === '-' ? -1 : 1))
  if (mode === 'startOfDay') {
    date.setUTCHours(0, 0, 0, 0)
  }
  else if (mode === 'endOfDay') {
    date.setUTCHours(23, 59, 59, 999)
  }
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
  if (Array.isArray(value)) {
    return value.map(normalize)
  }
  if (!isRecord(value)) {
    return value
  }
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
