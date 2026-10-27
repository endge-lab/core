import type { PathScalar, PathSegment } from '@raphy-js/raph'

import { DataPath } from '@raphy-js/raph'

// Путь value DSL: точечный путь прежней семантики или строгая грамматика DataPath Raph.
//
// Точечные пути без `[`, `$` и сегмента `*` читаются прежним способом (`current[key]`),
// поэтому существующие Source не меняют поведение. Пути с индексами `[0]`, селекторами
// `[поле=значение]` и переменными `$имя` разбираются DataPath Raph один раз и кешируются.
// Wildcard `*`/`[*]` допустим в Raph только в масках подписки: литеральный путь получает
// diagnostic при компиляции, динамический путь возвращает undefined с предупреждением.

export type ValuePathIssueCode = 'value-path-invalid' | 'value-path-wildcard' | 'value-path-variable'

// Ошибка разбора или разрешения пути.
export interface ValuePathIssue {
  code: ValuePathIssueCode
  message: string
  path: string
}

// Окружение чтения: переменные `$имя` и получатель предупреждений.
export interface ValuePathScope {
  vars?: Readonly<Record<string, unknown>>
  warn?: (issue: ValuePathIssue) => void
}

type ExactSegment = Exclude<PathSegment, { kind: 'wildcard' }>

type CompiledValuePath
  = | { kind: 'root' }
    | { kind: 'keys', keys: readonly string[] }
    | { kind: 'segments', segments: readonly ExactSegment[] }
    | { kind: 'variables', names: readonly string[], bracketNames: ReadonlySet<string> }
    | { kind: 'issue', issue: ValuePathIssue }

type ResolvedValuePath = Exclude<CompiledValuePath, { kind: 'variables' }>

interface SelectorIndex {
  length: number
  byKey: Map<string, Map<PathScalar, number>>
}

const MAX_CACHE_SIZE = 10_000
// Короткие массивы дешевле просматривать линейно, чем строить индекс.
const SELECTOR_INDEX_MIN_LENGTH = 16
const VARIABLE_PATTERN = /\$([A-Z_$][\w$]*)/gi
const BRACKET_VARIABLE_PATTERN = /(?:\[|=)\s*\$([A-Z_$][\w$]*)\s*\]/gi

const compiledPaths = new Map<string, CompiledValuePath>()
const resolvedVariablePaths = new Map<string, ResolvedValuePath>()
const selectorIndexes = new WeakMap<readonly unknown[], SelectorIndex>()

let activeScope: ValuePathScope | undefined

// Выполняет синхронное вычисление с заданными переменными и получателем предупреждений.
export function runWithValuePathScope<T>(scope: ValuePathScope, run: () => T): T {
  const previous = activeScope
  activeScope = scope
  try {
    return run()
  }
  finally {
    activeScope = previous
  }
}

// Читает значение по пути без исключений.
export function readValuePath(source: unknown, path: string, scope: ValuePathScope | undefined = activeScope): unknown {
  const compiled = resolveValuePath(path, scope)
  if (compiled.kind === 'root') {
    return source
  }
  if (compiled.kind === 'keys') {
    let current: any = source
    for (const key of compiled.keys) {
      if (current == null) {
        return undefined
      }
      current = current[key]
    }
    return current
  }
  if (compiled.kind === 'issue') {
    scope?.warn?.(compiled.issue)
    return undefined
  }
  return readSegments(source, compiled.segments)
}

// Проверяет наличие собственного значения по пути без исключений.
export function hasValuePath(source: unknown, path: string, scope: ValuePathScope | undefined = activeScope): boolean {
  const compiled = resolveValuePath(path, scope)
  if (compiled.kind === 'root') {
    return source !== undefined
  }
  if (compiled.kind === 'issue') {
    scope?.warn?.(compiled.issue)
    return false
  }
  let current: any = source
  if (compiled.kind === 'keys') {
    for (const key of compiled.keys) {
      if (current == null || !Object.hasOwn(new Object(current), key)) {
        return false
      }
      current = current[key]
    }
    return true
  }
  for (const segment of compiled.segments) {
    if (segment.kind === 'key') {
      if (current == null || !Object.hasOwn(new Object(current), segment.key)) {
        return false
      }
      current = current[segment.key]
      continue
    }
    if (!Array.isArray(current)) {
      return false
    }
    const index = segment.kind === 'index'
      ? (Object.hasOwn(current, segment.index) ? segment.index : -1)
      : findSelector(current, segment.key, segment.value)
    if (index === -1) {
      return false
    }
    current = current[index]
  }
  return true
}

// Проверяет синтаксис литерального пути при компиляции; переменные `$имя` считаются заданными.
export function validateValuePath(path: string): ValuePathIssue | null {
  if (isPlainPath(path)) {
    return null
  }
  const names = collectVariableNames(path)
  // Значение 0 допустимо во всех позициях: ключ "0", индекс [0] и скаляр селектора.
  const resolved = toResolved(path, names.length ? Object.fromEntries(names.map(name => [name, 0])) : undefined)
  return resolved.kind === 'issue' ? resolved.issue : null
}

function resolveValuePath(path: string, scope: ValuePathScope | undefined): ResolvedValuePath {
  const compiled = compileValuePath(path)
  if (compiled.kind !== 'variables') {
    return compiled
  }

  const vars: Record<string, unknown> = {}
  let cacheKey = path
  for (const name of compiled.names) {
    if (scope?.vars && Object.hasOwn(scope.vars, name)) {
      const value = scope.vars[name]
      vars[name] = value
      cacheKey += `\u0000${name}=${typeof value}:${typeof value === 'object' ? safeStringify(value) : String(value)}`
      continue
    }
    if (compiled.bracketNames.has(name)) {
      return {
        kind: 'issue',
        issue: {
          code: 'value-path-variable',
          message: `Переменная пути "$${name}" не задана.`,
          path,
        },
      }
    }
    // Ключ вида `$type` без одноимённой переменной читается буквально, как прежде.
    vars[name] = `$${name}`
  }

  const cached = resolvedVariablePaths.get(cacheKey)
  if (cached) {
    return cached
  }
  const resolved = toResolved(path, vars)
  remember(resolvedVariablePaths, cacheKey, resolved)
  return resolved
}

function compileValuePath(path: string): CompiledValuePath {
  const cached = compiledPaths.get(path)
  if (cached) {
    return cached
  }
  let compiled: CompiledValuePath
  if (!path) {
    compiled = { kind: 'root' }
  }
  else if (isPlainPath(path)) {
    const keys = path.split('.').filter(Boolean)
    compiled = keys.length ? { kind: 'keys', keys } : { kind: 'root' }
  }
  else if (path.includes('$')) {
    const bracketNames = new Set<string>()
    for (const match of path.matchAll(BRACKET_VARIABLE_PATTERN)) {
      bracketNames.add(match[1]!)
    }
    compiled = { kind: 'variables', names: collectVariableNames(path), bracketNames }
  }
  else {
    compiled = toResolved(path, undefined)
  }
  remember(compiledPaths, path, compiled)
  return compiled
}

function toResolved(path: string, vars: Record<string, unknown> | undefined): ResolvedValuePath {
  let segments: readonly PathSegment[]
  try {
    segments = DataPath.fromString(path, vars ? { vars } : undefined).segments()
  }
  catch (error) {
    return {
      kind: 'issue',
      issue: {
        code: 'value-path-invalid',
        message: `Некорректный путь "${path}": ${error instanceof Error ? error.message : String(error)}`,
        path,
      },
    }
  }
  if (segments.some(segment => segment.kind === 'wildcard')) {
    return {
      kind: 'issue',
      issue: {
        code: 'value-path-wildcard',
        message: `Путь "${path}" содержит wildcard; "*" и "[*]" допустимы только в масках подписки.`,
        path,
      },
    }
  }
  return segments.length
    ? { kind: 'segments', segments: segments as readonly ExactSegment[] }
    : { kind: 'root' }
}

function readSegments(source: unknown, segments: readonly ExactSegment[]): unknown {
  let current: any = source
  for (const segment of segments) {
    if (current == null) {
      return undefined
    }
    if (segment.kind === 'key') {
      current = current[segment.key]
      continue
    }
    if (!Array.isArray(current)) {
      return undefined
    }
    if (segment.kind === 'index') {
      current = current[segment.index]
      continue
    }
    const index = findSelector(current, segment.key, segment.value)
    if (index === -1) {
      return undefined
    }
    current = current[index]
  }
  return current
}

// Находит первый элемент массива с собственным полем, равным значению (Object.is), как DefaultDataAdapter.
// Индекс строится только для замороженных массивов: у изменяемых данных корректность важнее скорости,
// поэтому там всегда линейный поиск (решение координатора по W1).
function findSelector(array: readonly unknown[], key: string, value: PathScalar): number {
  if (array.length < SELECTOR_INDEX_MIN_LENGTH || !Object.isFrozen(array)) {
    return linearFindSelector(array, key, value)
  }
  let index = selectorIndexes.get(array)
  if (!index || index.length !== array.length) {
    index = { length: array.length, byKey: new Map() }
    selectorIndexes.set(array, index)
  }
  let bucket = index.byKey.get(key)
  if (!bucket) {
    bucket = buildSelectorBucket(array, key)
    index.byKey.set(key, bucket)
  }
  const indexed = bucket.get(value)
  if (indexed !== undefined && selectorMatches(array[indexed], key, value)) {
    return indexed
  }
  // Индекс устарел после изменения элементов: как в Raph, проверяем линейно и чиним запись.
  const found = linearFindSelector(array, key, value)
  if (found === -1) {
    bucket.delete(value)
  }
  else {
    bucket.set(value, found)
  }
  return found
}

function buildSelectorBucket(array: readonly unknown[], key: string): Map<PathScalar, number> {
  const bucket = new Map<PathScalar, number>()
  for (let index = 0; index < array.length; index++) {
    const item = array[index]
    if (!isRecord(item) || !Object.hasOwn(item, key)) {
      continue
    }
    const scalar = item[key]
    if (isPathScalar(scalar) && !bucket.has(scalar)) {
      bucket.set(scalar, index)
    }
  }
  return bucket
}

function linearFindSelector(array: readonly unknown[], key: string, value: PathScalar): number {
  for (let index = 0; index < array.length; index++) {
    if (selectorMatches(array[index], key, value)) {
      return index
    }
  }
  return -1
}

function selectorMatches(item: unknown, key: string, value: PathScalar): boolean {
  return isRecord(item) && Object.hasOwn(item, key) && Object.is(item[key], value)
}

function isPlainPath(path: string): boolean {
  if (path.includes('[') || path.includes('$')) {
    return false
  }
  if (!path.includes('*')) {
    return true
  }
  return !path.split('.').some(part => part.trim() === '*')
}

function collectVariableNames(path: string): string[] {
  return [...new Set([...path.matchAll(VARIABLE_PATTERN)].map(match => match[1]!))]
}

function remember<T>(cache: Map<string, T>, key: string, value: T): void {
  if (cache.size >= MAX_CACHE_SIZE) {
    cache.clear()
  }
  cache.set(key, value)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'undefined'
  }
  catch {
    return '[unserializable]'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPathScalar(value: unknown): value is PathScalar {
  return value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
}
