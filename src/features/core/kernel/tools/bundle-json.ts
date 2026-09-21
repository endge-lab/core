import type { BundleJsonValue } from '../types/endge-bundle.types'
import { NODE_FIELDS } from '@babel/types'

/** Отдельная копия wire values: не вызывает toJSON/getters и не скрывает неподдержанные значения. */
export function copyBundleJson(
  value: unknown,
  syntaxTree = false,
): BundleJsonValue {
  const visiting = new Set<object>()
  const visit = (input: unknown, depth: number): BundleJsonValue => {
    if (depth > 256) {
      throw new Error('[Bundle] Maximum nesting exceeded')
    }
    if (
      input === null
      || typeof input === 'string'
      || typeof input === 'boolean'
    ) {
      return input
    }
    if (typeof input === 'number' && Number.isFinite(input)) {
      return input
    }
    if (!input || typeof input !== 'object') {
      throw new Error('[Bundle] Value is not JSON serializable')
    }
    if (visiting.has(input)) {
      throw new Error('[Bundle] Cyclic value')
    }
    const prototype = Object.getPrototypeOf(input)
    if (
      !Array.isArray(input)
      && prototype !== Object.prototype
      && prototype !== null
      && !(syntaxTree && isParserValue(input))
    ) {
      throw new Error('[Bundle] Class instances are not portable')
    }
    visiting.add(input)
    let result: BundleJsonValue
    if (Array.isArray(input)) {
      result = input.map(item => visit(item, depth + 1))
    }
    else {
      const output: Record<string, BundleJsonValue> = {}
      for (const [key, descriptor] of Object.entries(
        Object.getOwnPropertyDescriptors(input),
      )) {
        if (!descriptor.enumerable) {
          continue
        }
        if (!('value' in descriptor)) {
          throw new Error('[Bundle] Accessor is not portable')
        }
        if (descriptor.value === undefined) {
          continue
        }
        Object.defineProperty(output, key, {
          value: visit(descriptor.value, depth + 1),
          enumerable: true,
          writable: true,
          configurable: true,
        })
      }
      result = output
    }
    visiting.delete(input)
    return result
  }
  return visit(value, 0)
}

/** Проверяет object без преобразования типов. */
export function bundleObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`[Bundle] Invalid ${label}`)
  }
  return value as Record<string, unknown>
}

/** Проверяет непустой идентификатор. */
export function bundleText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`[Bundle] Invalid ${label}`)
  }
  return value
}

/** Babel names are minified in browser builds; only its data shapes cross the AST boundary. */
function isParserValue(value: object): boolean {
  const fields = Object.getOwnPropertyDescriptors(value)
  const type = fields.type?.value
  if (typeof type === 'string' && Object.hasOwn(NODE_FIELDS, type)) {
    return true
  }
  const position = (input: unknown): boolean => {
    if (!input || typeof input !== 'object') {
      return false
    }
    const own = Object.getOwnPropertyDescriptors(input)
    return (
      Number.isSafeInteger(own.line?.value)
      && Number.isSafeInteger(own.column?.value)
      && Number.isSafeInteger(own.index?.value)
    )
  }
  return (
    position(value)
    || (position(fields.start?.value) && position(fields.end?.value))
  )
}

/** JSON object key order is not part of record identity across runtimes. */
export function equalBundleJson(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true
  }
  if (
    !left
    || !right
    || typeof left !== 'object'
    || typeof right !== 'object'
    || Array.isArray(left) !== Array.isArray(right)
  ) {
    return false
  }
  const before = left as Record<string, unknown>
  const after = right as Record<string, unknown>
  const keys = Object.keys(before)
  return (
    keys.length === Object.keys(after).length
    && keys.every(
      key =>
        Object.hasOwn(after, key) && equalBundleJson(before[key], after[key]),
    )
  )
}
