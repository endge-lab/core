import type { ConfigurationSourceValueDefinition } from '@/domain/types/source/configuration-source.types'

import { parse } from '@babel/parser'
import * as t from '@babel/types'

import { propertyName as readPropertyName, unwrapExpression } from '@/model/services/source-engine/compilers/source-expression-compile'
import { serializeTypeSourceExpression } from '@/model/services/source-engine/type-source-serialize'

export type ConfigurationSourcePatch
  = { op: 'upsert', value: ConfigurationSourceValueDefinition }
    | { op: 'remove', key: string }

/** Applies a narrow property-level patch to canonical defineConfig source. */
export function patchConfigurationSource(source: string, patch: ConfigurationSourcePatch): string {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] })
  const statement = ast.program.body[0]
  if (ast.program.body.length !== 1 || !statement || !t.isExpressionStatement(statement))
    throw new Error('Configuration source must contain exactly one defineConfig expression.')
  const call = unwrapExpression(statement.expression)
  if (!t.isCallExpression(call) || !t.isIdentifier(call.callee, { name: 'defineConfig' }))
    throw new Error('Configuration source must contain defineConfig(...).')
  const object = call.arguments[0]
  if (!object || !t.isObjectExpression(object) || object.start == null || object.end == null)
    throw new Error('defineConfig argument must be an object literal.')

  const key = patch.op === 'remove' ? patch.key : patch.value.key
  const property = object.properties.find((candidate): candidate is t.ObjectProperty =>
    t.isObjectProperty(candidate) && !candidate.computed && readPropertyName(candidate.key) === key)

  if (patch.op === 'remove') {
    if (!property || property.start == null || property.end == null) return source
    const range = propertyRemovalRange(object, property)
    return source.slice(0, range.start) + source.slice(range.end)
  }

  const serialized = serializeConfigurationValue(patch.value, indentationAt(source, property?.start ?? object.end - 1))
  if (property?.start != null && property.end != null)
    return source.slice(0, property.start) + serialized + source.slice(property.end)

  const close = object.end - 1
  const indent = indentationAt(source, close) + 2
  const content = source.slice(object.start + 1, close).trim()
  const prefix = content ? (content.endsWith(',') ? '\n' : ',\n') : '\n'
  return source.slice(0, close) + prefix + ' '.repeat(indent) + serializeConfigurationValue(patch.value, indent) + ',\n' + ' '.repeat(Math.max(0, indent - 2)) + source.slice(close)
}

/** Deterministic source for one value; visual authoring always writes an explicit default. */
export function serializeConfigurationValue(value: ConfigurationSourceValueDefinition, indent = 2): string {
  const continuation = ' '.repeat(indent + 2)
  const lines = [
    `${sourceProperty(value.key)}: value(${serializeTypeSourceExpression(value.type, indent)}, ${serializeJSON(value.defaultValue, indent)})`,
  ]
  if (value.label) lines.push(`${continuation}.label(${sourceString(value.label)})`)
  if (value.description) lines.push(`${continuation}.description(${sourceString(value.description)})`)
  if (value.min != null) lines.push(`${continuation}.min(${value.min})`)
  if (value.max != null) lines.push(`${continuation}.max(${value.max})`)
  if (value.step != null) lines.push(`${continuation}.step(${value.step})`)
  return lines.join('\n')
}

function serializeJSON(value: unknown, indent: number): string {
  if (value != null && typeof value === 'object')
    return JSON.stringify(value, null, 2).replace(/\n/g, `\n${' '.repeat(indent + 2)}`)
  return JSON.stringify(value)
}

function sourceProperty(value: string): string {
  return t.isValidIdentifier(value) ? value : sourceString(value)
}

function sourceString(value: string): string {
  return JSON.stringify(value)
}

function indentationAt(source: string, offset: number): number {
  const lineStart = source.lastIndexOf('\n', Math.max(0, offset - 1)) + 1
  return /^\s*/.exec(source.slice(lineStart, offset))?.[0].length ?? 0
}

function propertyRemovalRange(object: t.ObjectExpression, property: t.ObjectProperty): { start: number, end: number } {
  const properties = object.properties.filter((item): item is t.ObjectProperty => t.isObjectProperty(item))
  const index = properties.indexOf(property)
  const next = properties[index + 1]
  if (next?.start != null) return { start: property.start!, end: next.start }
  const previous = properties[index - 1]
  if (previous?.end != null) return { start: previous.end, end: property.end! }
  return { start: property.start!, end: property.end! }
}
