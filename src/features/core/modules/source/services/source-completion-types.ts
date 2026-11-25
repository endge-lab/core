import type { SourceExpressionIR, SourceFieldDefinition } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { TypeSourceDefinition, TypeSourceExpression, TypeSourceField } from '@/features/core/modules/source/domain/types/type-source.types'

export type ResolveCompletionType = (identity: string) => TypeSourceDefinition | null | undefined

interface ExpressionTypes {
  resolveType: ResolveCompletionType
  reads: Partial<Record<string, TypeSourceExpression>>
  current?: TypeSourceExpression
  read?: (expression: Extract<SourceExpressionIR, { type: 'read' }>) => TypeSourceExpression | undefined
}

const SAMPLE_PRIMITIVES: Record<string, string> = { string: 'String', boolean: 'Boolean', number: 'Number', Null: 'Null' }
const UNKNOWN: TypeSourceExpression = { kind: 'reference', identity: 'Any' }
const COLLECTION_SELECTORS = new Set(['map', 'flat-map', 'where', 'reject', 'find', 'some', 'every', 'sort-by', 'sort-by-desc', 'uniq-by', 'group-by', 'key-by', 'count-by', 'sum-by', 'average-by', 'min-by', 'max-by'])
export const completionCollectionSelectors = new Set([...COLLECTION_SELECTORS].map(name => name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())))

export function completionObjectType(fields: TypeSourceField[]): TypeSourceDefinition {
  return { kind: 'object', fields }
}

export function completionTypeField(key: string, type: TypeSourceExpression = UNKNOWN): TypeSourceField {
  return { key, type, optional: false, array: false, examples: [] }
}

export function sourceFieldCompletionType(field: SourceFieldDefinition): TypeSourceExpression {
  const type = field.typeExpression ?? { kind: 'reference', identity: field.type }
  return field.array ? { kind: 'array', items: type } : type
}

export function sourceFieldsCompletionType(fields: SourceFieldDefinition[]): TypeSourceDefinition {
  return completionObjectType(fields.map(field => ({
    ...completionTypeField(field.key, sourceFieldCompletionType(field)),
    optional: field.optional,
  })))
}

// Samples are used only to describe in-memory data. Exclude values from suggestions.
export function sampleCompletionType(value: unknown): TypeSourceExpression {
  let budget = 800
  const describe = (sample: unknown, depth: number): TypeSourceExpression => {
    if (depth >= 8 || budget-- <= 0) {
      return UNKNOWN
    }
    if (Array.isArray(sample)) {
      const items = sample.slice(0, 5).map(item => describe(item, depth + 1))
      return { kind: 'array', items: union(items) ?? UNKNOWN }
    }
    if (sample && typeof sample === 'object') {
      return completionObjectType(Object.keys(sample).slice(0, 120).map((key) => {
        const property = Object.getOwnPropertyDescriptor(sample, key)
        return completionTypeField(key, describe(property?.value, depth + 1))
      }))
    }
    const primitive = SAMPLE_PRIMITIVES[sample === null ? 'Null' : typeof sample]
    return primitive ? { kind: 'reference', identity: primitive } : UNKNOWN
  }
  return describe(value, 0)
}

export function completionTypeFields(
  type: TypeSourceExpression | undefined,
  resolveType: ResolveCompletionType,
  seen: ReadonlySet<string> = new Set(),
): TypeSourceField[] {
  if (type?.kind === 'reference' && !seen.has(type.identity)) {
    return completionTypeFields(resolveType(type.identity) ?? undefined, resolveType, new Set([...seen, type.identity]))
  }
  if (type?.kind === 'object') {
    const inherited = type.extends
      ? completionTypeFields(type.extends, resolveType, seen)
      : []
    return [...new Map([...inherited, ...type.fields].map(field => [field.key, field])).values()]
  }
  if (type?.kind !== 'union') {
    return []
  }

  const variants = type.variants.map(variant => completionTypeFields(variant, resolveType, seen))
  const byKey = new Map<string, TypeSourceField[]>()
  for (const fields of variants) {
    for (const field of fields) {
      const matches = byKey.get(field.key) ?? []
      matches.push(field)
      byKey.set(field.key, matches)
    }
  }
  return [...byKey.entries()].map(([key, fields]) => ({
    ...completionTypeField(key, union(fields.map(fieldType))),
    description: fields.find(field => field.description)?.description,
    optional: fields.length < variants.length || fields.some(field => field.optional),
  }))
}

// A field present in only some computed rows is an optional member for authoring.
export function computedCompletionType(type: TypeSourceExpression, resolveType: ResolveCompletionType, depth = 0): TypeSourceExpression {
  if (depth >= 12) {
    return UNKNOWN
  }
  if (type.kind === 'array') {
    return { ...type, items: computedCompletionType(type.items, resolveType, depth + 1) }
  }
  if (type.kind === 'union') {
    const variants = type.variants.filter(variant => variant.kind !== 'reference' || variant.identity !== 'Null')
    const items = variants.map(variant => completionItemType(variant, resolveType))
    if (items.length && items.every(item => item !== undefined)) {
      return { kind: 'array', items: computedCompletionType({ kind: 'union', variants: items.filter(item => item !== undefined) }, resolveType, depth + 1) }
    }
    const fields = completionTypeFields({ ...type, variants }, resolveType)
    if (fields.length) {
      return computedCompletionType(completionObjectType(fields), resolveType, depth + 1)
    }
  }
  if (type.kind === 'object') {
    return { ...type, fields: type.fields.map(field => ({ ...field, type: computedCompletionType(field.type, resolveType, depth + 1) })) }
  }
  return type
}

export function completionItemType(
  type: TypeSourceExpression | undefined,
  resolveType: ResolveCompletionType,
  depth = 0,
): TypeSourceExpression | undefined {
  if (depth >= 12) {
    return undefined
  }
  const target = resolveReference(type, resolveType)
  if (target?.kind === 'array') {
    return target.items
  }
  if (target?.kind === 'union') {
    return union(target.variants.flatMap(variant => completionItemType(variant, resolveType, depth + 1) ?? []))
  }
}

export function readCompletionType(
  type: TypeSourceExpression | undefined,
  path: string,
  resolveType: ResolveCompletionType,
): TypeSourceExpression | undefined {
  const segments = path.replace(/\[(?:\d+|[^\]=]+=[^\]]+)\]/g, '.0').split('.').filter(Boolean)
  return segments.reduce<TypeSourceExpression | undefined>((current, key) => {
    const target = resolveReference(current, resolveType)
    if (/^\d+$/.test(key)) {
      const item = completionItemType(target, resolveType)
      if (item) {
        return item
      }
    }
    if (target?.kind === 'record') {
      return target.values
    }
    const field = completionTypeFields(target, resolveType).find(field => field.key === key)
    return field ? fieldType(field) : undefined
  }, type)
}

export function inferSourceExpressionType(
  expression: SourceExpressionIR | null | undefined,
  context: ExpressionTypes,
  depth = 0,
): TypeSourceExpression | undefined {
  if (!expression || depth >= 40) {
    return undefined
  }
  const infer = (input: SourceExpressionIR | undefined, current = context.current) =>
    inferSourceExpressionType(input, { ...context, current }, depth + 1)
  const read = (type: TypeSourceExpression | undefined, path: string) => readCompletionType(type, path, context.resolveType)
  const item = (type: TypeSourceExpression | undefined) => completionItemType(type, context.resolveType)

  switch (expression.type) {
    case 'literal':
      return sampleCompletionType(expression.value)
    case 'array':
      return { kind: 'array', items: union(expression.items.flatMap(value => infer(value) ?? [])) ?? UNKNOWN }
    case 'object':
      return completionObjectType(Object.entries(expression.properties).map(([key, value]) => completionTypeField(key, infer(value))))
    case 'read': {
      const root = ['current', 'row', 'scope'].includes(expression.source) ? context.current : context.reads[expression.source]
      return context.read?.(expression) ?? read(root, expression.parameters?.join('.') ?? expression.path)
    }
    case 'transform':
      return undefined
    case 'operation': {
      const [first, second, third] = expression.arguments
      const left = infer(first)
      const row = item(left)
      switch (expression.operation) {
        case 'get':
        case 'get-or':
          if (second?.type === 'literal' && typeof second.value === 'string') {
            return read(left, second.value) ?? (expression.operation === 'get-or' ? infer(third) : undefined)
          }
          return undefined
        case 'map':
        case 'flat-map': {
          const mapped = infer(second, row)
          return { kind: 'array', items: (expression.operation === 'flat-map' ? item(mapped) : mapped) ?? UNKNOWN }
        }
        case 'where':
        case 'reject':
        case 'sort-by':
        case 'sort-by-desc':
        case 'order-by':
        case 'take':
        case 'drop':
        case 'uniq':
        case 'uniq-by':
        case 'reverse':
        case 'lookup-many':
          return left
        case 'join-by':
        case 'join-by-any':
          return first?.type === 'operation' && ['lookup-one', 'lookup-many'].includes(first.operation) ? left : undefined
        case 'first':
        case 'last':
        case 'at':
        case 'find':
        case 'lookup-one':
        case 'min-by':
        case 'max-by':
          return row
        case 'flatten':
          return { kind: 'array', items: item(row) ?? UNKNOWN }
        case 'concat': {
          const items = expression.arguments.flatMap(arg => item(infer(arg)) ?? [])
          return items.length ? { kind: 'array', items: union(items) ?? UNKNOWN } : undefined
        }
        case 'merge':
        case 'defaults': {
          const fields = expression.arguments.flatMap(arg => completionTypeFields(infer(arg), context.resolveType))
          if (expression.operation === 'defaults') {
            fields.reverse()
          }
          return fields.length ? completionObjectType([...new Map(fields.map(field => [field.key, field])).values()]) : undefined
        }
        case 'pick': {
          const keys = expression.arguments.slice(1).flatMap(arg => arg.type === 'array' ? arg.items : [arg]).flatMap(arg => arg.type === 'literal' && typeof arg.value === 'string' ? [arg.value] : [])
          return completionObjectType(completionTypeFields(left, context.resolveType).filter(field => keys.includes(field.key)))
        }
        case 'default-to':
        case 'coalesce':
          return union(expression.arguments.flatMap(arg => infer(arg) ?? []))
        default:
          return undefined
      }
    }
  }
}

function fieldType(field: TypeSourceField): TypeSourceExpression {
  return field.array ? { kind: 'array', items: field.type } : field.type
}

function resolveReference(type: TypeSourceExpression | undefined, resolveType: ResolveCompletionType): TypeSourceExpression | undefined {
  return type?.kind === 'reference' ? resolveType(type.identity) ?? type : type
}

function union(types: TypeSourceExpression[]): TypeSourceExpression | undefined {
  return types.length > 1 ? { kind: 'union', variants: types } : types[0]
}
