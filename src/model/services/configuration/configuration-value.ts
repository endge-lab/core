import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { EndgeJSONValue } from '@/domain/types/source/configuration-source.types'
import type { TypeProgramCatalogEntry, TypeSourceExpression } from '@/domain/types/source/type-source.types'

import { normalizeComponentSFCInteractionTriggers } from '@/tools/component-sfc-edit-trigger'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

export interface ConfigurationValueResult {
  ok: boolean
  diagnostics: DiagnosticDraft[]
}

/** Validates one persisted/default value against the effective Type Registry. */
export function validateConfigurationValue(
  expression: TypeSourceExpression,
  value: unknown,
  catalog: readonly TypeProgramCatalogEntry[],
  sourcePath = 'value',
): ConfigurationValueResult {
  const diagnostics = validateExpression(expression, value, catalog, sourcePath, new Set())
  return { ok: diagnostics.length === 0, diagnostics }
}

/** Infers a deterministic JSON default or returns null when explicit author input is required. */
export function inferConfigurationDefault(
  expression: TypeSourceExpression,
  catalog: readonly TypeProgramCatalogEntry[],
  visiting = new Set<string>(),
): { ok: true, value: EndgeJSONValue } | { ok: false, reason: string } {
  if (expression.kind === 'reference') {
    const identity = expression.identity
    if (identity === 'String' || identity === 'ID' || identity === 'Time' || identity === 'DateTime')
      return { ok: true, value: '' }
    if (identity === 'Number') return { ok: true, value: 0 }
    if (identity === 'Boolean') return { ok: true, value: false }
    if (identity === 'Null' || identity === 'Any') return { ok: true, value: null }
    if (identity === 'Object' || identity === 'JSON') return { ok: true, value: {} }
    if (identity === 'TriggerSet') return { ok: true, value: [] }

    const type = catalog.find(item => item.identity === identity)
    if (!type)
      return { ok: false, reason: `Type "${identity}" is not registered` }
    if (type.category === 'reference')
      return { ok: false, reason: `Reference Type "${identity}" requires an explicit default` }
    if (!type.definition)
      return { ok: false, reason: `Type "${identity}" has no structural definition` }
    if (visiting.has(identity))
      return { ok: false, reason: `Recursive Type "${identity}" requires an explicit default` }
    const next = new Set(visiting)
    next.add(identity)
    return inferConfigurationDefault(type.definition, catalog, next)
  }

  if (expression.kind === 'array')
    return { ok: true, value: [] }
  if (expression.kind === 'record')
    return { ok: true, value: {} }
  if (expression.kind === 'enum') {
    return expression.values.length > 0
      ? { ok: true, value: expression.values[0] as EndgeJSONValue }
      : { ok: false, reason: 'Empty enum requires an explicit default' }
  }
  if (expression.kind === 'union') {
    for (const variant of expression.variants) {
      const inferred = inferConfigurationDefault(variant, catalog, new Set(visiting))
      if (inferred.ok)
        return inferred
    }
    return { ok: false, reason: 'Union has no inferable variant default' }
  }

  const result: Record<string, EndgeJSONValue> = {}
  for (const field of expression.fields) {
    if (field.optional)
      continue
    if (field.array) {
      result[field.key] = []
      continue
    }
    const inferred = inferConfigurationDefault(field.type, catalog, new Set(visiting))
    if (!inferred.ok)
      return inferred
    result[field.key] = inferred.value
  }
  return { ok: true, value: result }
}

export function isEndgeJSONValue(value: unknown): value is EndgeJSONValue {
  if (value == null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (Array.isArray(value))
    return value.every(isEndgeJSONValue)
  if (!isRecord(value))
    return false
  return Object.keys(value).every(isSafeKey) && Object.values(value).every(isEndgeJSONValue)
}

function validateExpression(
  expression: TypeSourceExpression,
  value: unknown,
  catalog: readonly TypeProgramCatalogEntry[],
  path: string,
  visiting: Set<string>,
): DiagnosticDraft[] {
  if (!isEndgeJSONValue(value))
    return [error(path, 'Value must be JSON-serializable and use safe object keys')]

  if (expression.kind === 'reference') {
    const identity = expression.identity
    if (identity === 'Any' || identity === 'JSON') return []
    if (identity === 'String' || identity === 'Time' || identity === 'DateTime')
      return typeof value === 'string' ? [] : [error(path, `Expected ${identity}`)]
    if (identity === 'Number')
      return typeof value === 'number' && Number.isFinite(value) ? [] : [error(path, 'Expected Number')]
    if (identity === 'Boolean')
      return typeof value === 'boolean' ? [] : [error(path, 'Expected Boolean')]
    if (identity === 'Null')
      return value === null ? [] : [error(path, 'Expected Null')]
    if (identity === 'ID')
      return typeof value === 'string' || typeof value === 'number' ? [] : [error(path, 'Expected ID')]
    if (identity === 'Object')
      return isRecord(value) ? [] : [error(path, 'Expected Object')]
    if (identity === 'TriggerSet') {
      if (!Array.isArray(value)) return [error(path, 'Expected TriggerSet array')]
      const normalized = normalizeComponentSFCInteractionTriggers(value)
      if (normalized.length !== value.length)
        return [error(path, 'TriggerSet contains invalid trigger descriptors')]
      if (normalized.some(trigger => trigger.passive && trigger.prevent))
        return [error(path, 'Trigger cannot combine passive and prevent')]
      return []
    }

    const type = catalog.find(item => item.identity === identity)
    if (!type)
      return [error(path, `Unknown Type "${identity}"`)]
    if (type.category === 'reference') {
      return typeof value === 'string' || typeof value === 'number'
        ? []
        : [error(path, `Expected ${identity} identity`)]
    }
    if (!type.definition || visiting.has(identity))
      return []
    const next = new Set(visiting)
    next.add(identity)
    return validateExpression(type.definition, value, catalog, path, next)
  }

  if (expression.kind === 'array') {
    if (!Array.isArray(value)) return [error(path, 'Expected array')]
    return value.flatMap((item, index) => validateExpression(expression.items, item, catalog, `${path}.${index}`, new Set(visiting)))
  }
  if (expression.kind === 'record') {
    if (!isRecord(value)) return [error(path, 'Expected object record')]
    return Object.entries(value).flatMap(([key, item]) => validateExpression(expression.values, item, catalog, `${path}.${key}`, new Set(visiting)))
  }
  if (expression.kind === 'enum') {
    return expression.values.some(item => Object.is(item, value))
      ? []
      : [error(path, 'Value is outside enum')]
  }
  if (expression.kind === 'union') {
    return expression.variants.some(variant => validateExpression(variant, value, catalog, path, new Set(visiting)).length === 0)
      ? []
      : [error(path, 'Value does not match any union variant')]
  }
  if (!isRecord(value)) return [error(path, 'Expected object')]

  const diagnostics: DiagnosticDraft[] = []
  for (const field of expression.fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field.key)) {
      if (!field.optional) diagnostics.push(error(`${path}.${field.key}`, 'Required field is missing'))
      continue
    }
    const fieldValue = value[field.key]
    if (field.array) {
      if (!Array.isArray(fieldValue)) diagnostics.push(error(`${path}.${field.key}`, 'Expected array'))
      else diagnostics.push(...fieldValue.flatMap((item, index) => validateExpression(field.type, item, catalog, `${path}.${field.key}.${index}`, new Set(visiting))))
      continue
    }
    diagnostics.push(...validateExpression(field.type, fieldValue, catalog, `${path}.${field.key}`, new Set(visiting)))
  }
  return diagnostics
}

function error(sourcePath: string, message: string): DiagnosticDraft {
  return { severity: 'error', code: 'configuration-value-invalid', message, sourcePath }
}

function isRecord(value: unknown): value is Record<string, EndgeJSONValue> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isSafeKey(key: string): boolean {
  return key !== '__proto__' && key !== 'prototype' && key !== 'constructor'
}

