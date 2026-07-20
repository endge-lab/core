import type {
  TypeSourceDefinition,
  TypeSourceDocument,
  TypeSourceExpression,
  TypeSourceField,
} from '@/domain/types/source/type-source.types'

/** Deterministic serializer for canonical Type Source v1 documents. */
export function serializeTypeSourceDocument(document: TypeSourceDocument): string {
  return `defineType(${serializeDefinition(document.definition)})\n`
}

function serializeDefinition(definition: TypeSourceDefinition): string {
  return definition.kind === 'object'
    ? serializeObject(definition, 0)
    : serializeExpression(definition, 0)
}

function serializeObject(definition: Extract<TypeSourceDefinition, { kind: 'object' }>, indent: number): string {
  if (!definition.fields.length) return '{}'
  const fields = definition.fields.map(field => serializeField(field, indent + 2)).join(',\n\n')
  return `{\n${fields},\n${' '.repeat(indent)}}`
}

function serializeExpression(expression: TypeSourceExpression, indent: number): string {
  if (expression.kind === 'reference') return `type(${sourceString(expression.identity)})`
  if (expression.kind === 'object') return `objectOf(${serializeObject(expression, indent)})`
  if (expression.kind === 'enum') {
    const values = expression.values
      .map(value => `${' '.repeat(indent + 2)}${staticValue(value)},`)
      .join('\n')
    return `enumOf([\n${values}\n${' '.repeat(indent)}])`
  }
  if (expression.kind === 'union') {
    const variants = expression.variants
      .map(value => `${' '.repeat(indent + 2)}${serializeExpression(value, indent + 2)},`)
      .join('\n')
    return `unionOf(\n${variants}\n${' '.repeat(indent)})`
  }
  return `arrayOf(\n${' '.repeat(indent + 2)}${serializeExpression(expression.items, indent + 2)},\n${' '.repeat(indent)})`
}

function serializeField(field: TypeSourceField, indent: number): string {
  const prefix = ' '.repeat(indent)
  const modifierPrefix = ' '.repeat(indent + 2)
  const type = field.type.kind === 'reference'
    ? sourceString(field.type.identity)
    : serializeExpression(field.type, indent)
  const lines = [`${prefix}${propertyName(field.key)}: field(${type})`]
  if (field.description) lines.push(`${modifierPrefix}.description(${sourceString(field.description)})`)
  if (field.min != null) lines.push(`${modifierPrefix}.min(${field.min})`)
  if (field.max != null) lines.push(`${modifierPrefix}.max(${field.max})`)
  for (const example of field.examples) lines.push(`${modifierPrefix}.example(${staticValue(example)})`)
  if (field.array) lines.push(`${modifierPrefix}.array()`)
  if (field.optional) lines.push(`${modifierPrefix}.optional()`)
  return lines.join('\n')
}

function staticValue(value: unknown): string {
  if (typeof value === 'string') return sourceString(value)
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value)
  if (Array.isArray(value)) return `[${value.map(staticValue).join(', ')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, nested]) => `${propertyName(key)}: ${staticValue(nested)}`)
    return `{ ${entries.join(', ')} }`
  }
  return 'null'
}

function propertyName(value: string): string {
  return /^[A-Z_$][\w$]*$/i.test(value) ? value : sourceString(value)
}

function sourceString(value: string): string {
  const json = JSON.stringify(value)
  return `'${json.slice(1, -1).replace(/\\"/g, '"').replace(/'/g, String.raw`\'`)}'`
}
