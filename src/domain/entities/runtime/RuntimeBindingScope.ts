import type { RuntimeHost } from '@/domain/types/runtime/runtime-host.types'

/**
 * Минимальная binding-scope модель runtime.
 * Хранит базовый путь и алиасы, от которых компоненты строят локальные selectors.
 */
export interface RuntimeBindingScope {
  parentRuntimeId: string | null
  basePath: string | null
  aliases: Record<string, string>
}

/**
 * Привести unknown-значение к RuntimeBindingScope, если это возможно.
 */
export function asRuntimeBindingScope(value: unknown): RuntimeBindingScope | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const src = value as Record<string, unknown>
  const aliasesSrc
    = src.aliases && typeof src.aliases === 'object'
      ? src.aliases as Record<string, unknown>
      : {}

  return {
    parentRuntimeId: String(src.parentRuntimeId ?? '').trim() || null,
    basePath: String(src.basePath ?? '').trim() || null,
    aliases: Object.fromEntries(
      Object.entries(aliasesSrc).map(([key, item]) => [key, String(item ?? '')]),
    ),
  }
}

/**
 * Собрать binding-scope для runtime.
 * Если explicit scope не передан, пытается унаследовать scope родителя
 * и только потом fallback-ится на legacy basePath.
 */
export function resolveRuntimeBindingScope(input: {
  parent?: RuntimeHost<any, any> | null
  basePath?: string | null
  sourceVar?: string | null
  scope?: Partial<RuntimeBindingScope> | null
}): RuntimeBindingScope {
  const parentScope = asRuntimeBindingScope(input.parent?.meta?.scope)
  const explicitScope = asRuntimeBindingScope(input.scope)

  const basePath = String(
    explicitScope?.basePath
      ?? input.basePath
      ?? parentScope?.basePath
      ?? '',
  ).trim()

  const aliases: Record<string, string> = {
    ...(parentScope?.aliases ?? {}),
    ...(explicitScope?.aliases ?? {}),
  }

  if (basePath && !aliases.root) {
    aliases.root = basePath
  }

  const sourceVar = String(input.sourceVar ?? '').trim()
  if (basePath && sourceVar && !aliases.items) {
    aliases.items = `${basePath}.${sourceVar}`
  }

  if (aliases.items && !aliases.row) {
    aliases.row = `${aliases.items}[$i]`
  }

  return {
    parentRuntimeId:
      explicitScope?.parentRuntimeId
      ?? input.parent?.id
      ?? parentScope?.parentRuntimeId
      ?? null,
    basePath: basePath || null,
    aliases,
  }
}

/**
 * Прочитать путь массива items из scope.
 */
export function getRuntimeScopeItemsPath(scope: RuntimeBindingScope): string {
  return String(scope.aliases.items ?? '').trim()
}

/**
 * Прочитать шаблон пути строки из scope.
 */
export function getRuntimeScopeRowPath(scope: RuntimeBindingScope): string {
  const explicit = String(scope.aliases.row ?? '').trim()
  if (explicit) {
    return explicit
  }

  const itemsPath = getRuntimeScopeItemsPath(scope)
  return itemsPath ? `${itemsPath}[$i]` : ''
}

/**
 * Скомпилировать selector таблицы в абсолютный runtime path.
 * Поддерживает:
 * - legacy absolute: `$store...`
 * - scope aliases: `@root.`, `@items.`, `@row.`
 * - relative row selectors: `number`, `attrs[name='STA'].dateTime`
 */
export function resolveScopedTablePath(input: {
  rawPath: string
  scope: RuntimeBindingScope
  rowIndex?: number
}): { path: string, vars: Record<string, any> } {
  const rawPath = String(input.rawPath ?? '').trim()
  const rootPath = String(input.scope.aliases.root ?? input.scope.basePath ?? '').trim()
  const itemsPath = getRuntimeScopeItemsPath(input.scope)
  const rowPath = getRuntimeScopeRowPath(input.scope)

  let path = rawPath

  if (rawPath.startsWith('@root.')) {
    path = rootPath
      ? `${rootPath}.${rawPath.slice('@root.'.length)}`
      : rawPath.slice('@root.'.length)
  }
  else if (rawPath === '@root') {
    path = rootPath
  }
  else if (rawPath.startsWith('@items.')) {
    path = itemsPath
      ? `${itemsPath}.${rawPath.slice('@items.'.length)}`
      : rawPath.slice('@items.'.length)
  }
  else if (rawPath === '@items') {
    path = itemsPath
  }
  else if (rawPath.startsWith('@row.')) {
    path = rowPath
      ? `${rowPath}.${rawPath.slice('@row.'.length)}`
      : rawPath.slice('@row.'.length)
  }
  else if (rawPath === '@row') {
    path = rowPath
  }
  else if (rawPath.startsWith('$store')) {
    path = rootPath ? rawPath.replace(/\$store\b/g, rootPath) : rawPath
  }
  else if (rowPath) {
    path = `${rowPath}.${rawPath}`
  }

  const vars: Record<string, any> = {}
  if (typeof input.rowIndex === 'number') {
    vars.i = input.rowIndex
  }

  return { path, vars }
}
