import type { SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { TypeProgramCatalogEntry, TypeSourceExpression } from '@/features/core/modules/source/domain/types/type-source.types'

export function validateControllerValue(field: SourceFieldDefinition, value: unknown, catalog: readonly TypeProgramCatalogEntry[]): void {
  if (value === undefined || value === null) {
    if (field.optional) {
      return
    }
    throw new Error(`controller-value-required: ${field.key}`)
  }
  const expression = field.typeExpression ?? {
    kind: 'reference' as const,
    identity: field.type,
  }
  if (field.array) {
    if (!Array.isArray(value) || !value.every(item => matches(expression, item, catalog, new Set()))) {
      throw new Error(`controller-value-type: ${field.key}`)
    }
  }
  else
    if (!matches(expression, value, catalog, new Set())) {
      throw new Error(`controller-value-type: ${field.key}`)
    }
}
function matches(expression: TypeSourceExpression, value: unknown, catalog: readonly TypeProgramCatalogEntry[], seen: Set<string>): boolean {
  if (expression.kind === 'reference') {
    switch (expression.identity) {
      case 'Any':
      case 'any':
      case 'unknown':
        return true
      case 'String':
      case 'string':
        return typeof value === 'string'
      case 'Number':
      case 'number':
        return typeof value === 'number' && Number.isFinite(value)
      case 'Boolean':
      case 'boolean':
        return typeof value === 'boolean'
      case 'Object':
      case 'object':
      case 'Record':
        return value !== null && typeof value === 'object' && !Array.isArray(value)
      case 'Null':
      case 'null':
        return value === null
      case 'Void':
      case 'void':
      case 'undefined':
        return value === undefined
      case 'ID':
        return typeof value === 'string' || typeof value === 'number'
      case 'Array':
        return Array.isArray(value)
      case 'Date':
      case 'Time':
      case 'DateTime':
        return typeof value === 'string' || value instanceof Date
    }
    if (seen.has(expression.identity)) {
      return false
    }
    const definition = catalog.find(type => type.identity === expression.identity)?.definition
    if (!definition) {
      return false
    }
    return matches(definition, value, catalog, new Set([...seen, expression.identity]))
  }
  if (expression.kind === 'union') {
    return expression.variants.some(item => matches(item, value, catalog, new Set(seen)))
  }
  if (expression.kind === 'enum') {
    return expression.values.some(item => Object.is(item, value))
  }
  if (expression.kind === 'array') {
    return Array.isArray(value) && value.every(item => matches(expression.items, item, catalog, new Set(seen)))
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  if (expression.kind === 'record') {
    return Object.values(value).every(item => matches(expression.values, item, catalog, new Set(seen)))
  }
  return expression.fields.every((field) => {
    const item = (value as Record<string, unknown>)[field.key]
    if (item === undefined && field.optional) {
      return true
    }
    return field.array ? Array.isArray(item) && item.every(value => matches(field.type, value, catalog, new Set(seen))) : matches(field.type, item, catalog, new Set(seen))
  })
}
