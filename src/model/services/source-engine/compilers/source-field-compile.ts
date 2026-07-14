import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type {
  SourceFieldDefinition,
  SourceFieldDefaultSource,
  SourceFieldOption,
  SourceFieldType,
} from '@/domain/types/source/source-expression.types'

import * as t from '@babel/types'

import {
  compileSourceExpression,
  diagnostic,
  propertyName,
  readStringArgument,
  unwrapExpression,
} from '@/model/services/source-engine/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

export interface SourceFieldParseResult {
  field: SourceFieldDefinition
  defaultSource?: SourceFieldDefaultSource
}

const FIELD_TYPES = new Set<SourceFieldType>(['String', 'Number', 'Boolean', 'Date', 'Time', 'DateTime', 'Object'])

/** Компилирует chain field(...).optional().array()... в общий field contract. */
export function compileSourceField(
  key: string,
  raw: t.Expression,
  source: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceFieldParseResult | null {
  let current = unwrapExpression(raw)
  const modifiers: Array<{ name: string, call: t.CallExpression }> = []

  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const name = propertyName(current.callee.property)
    if (!name || !t.isExpression(current.callee.object))
      break
    modifiers.unshift({ name, call: current })
    current = unwrapExpression(current.callee.object)
  }

  if (!t.isCallExpression(current) || !t.isIdentifier(current.callee, { name: 'field' })) {
    diagnostics.push(diagnostic('error', 'source-field-shape', 'Поле должно быть объявлено через field(type).', sourcePath, raw))
    return null
  }

  const rawType = readStringArgument(current, 0)
  if (!rawType || !FIELD_TYPES.has(rawType as SourceFieldType)) {
    diagnostics.push(diagnostic('error', 'source-field-type', `Тип поля "${rawType ?? ''}" не поддерживается.`, sourcePath, current))
    return null
  }

  const field: SourceFieldDefinition = {
    key,
    type: rawType as SourceFieldType,
    optional: false,
    array: false,
  }
  let defaultSource: SourceFieldDefaultSource | undefined

  for (const modifier of modifiers) {
    if (modifier.name === 'optional') {
      field.optional = true
      continue
    }
    if (modifier.name === 'array') {
      field.array = true
      continue
    }
    if (modifier.name === 'default') {
      const argument = modifier.call.arguments[0]
      if (argument && t.isExpression(argument))
        field.defaultValue = compileSourceExpression(argument, diagnostics, `${sourcePath}.default`) ?? undefined
      else
        diagnostics.push(diagnostic('error', 'source-field-default', '.default(...) требует expression.', `${sourcePath}.default`, modifier.call))
      continue
    }
    if (modifier.name === 'options') {
      field.options = readOptions(modifier.call.arguments[0], diagnostics, `${sourcePath}.options`)
      continue
    }
    if (modifier.name === 'vocab') {
      field.vocab = readVocab(modifier.call, diagnostics, `${sourcePath}.vocab`) ?? undefined
      continue
    }
    if (modifier.name === 'from') {
      defaultSource = readDefaultSource(modifier.call.arguments[0], source, diagnostics, `${sourcePath}.from`) ?? undefined
      continue
    }

    diagnostics.push(diagnostic('error', 'source-field-method-unsupported', `field().${modifier.name}(...) не поддерживается.`, sourcePath, modifier.call))
  }

  if (field.options && field.vocab) {
    diagnostics.push(diagnostic('error', 'source-field-options-vocab-conflict', 'Поле не может одновременно использовать options и vocab.', sourcePath, raw))
  }
  if (defaultSource && field.defaultValue) {
    diagnostics.push(diagnostic('error', 'source-field-default-source-conflict', 'Поле не может одновременно использовать default и from.', sourcePath, raw))
  }
  if (field.options && !field.options.length) {
    diagnostics.push(diagnostic('warning', 'source-field-options-empty', 'options объявлен пустым массивом.', `${sourcePath}.options`, raw))
  }

  validateLiteralDefault(field, diagnostics, sourcePath, raw)
  return { field, defaultSource }
}

function readOptions(
  raw: t.CallExpression['arguments'][number] | undefined,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceFieldOption[] {
  if (!raw || !t.isArrayExpression(raw)) {
    diagnostics.push(diagnostic('error', 'source-field-options-array', '.options(...) принимает массив.', sourcePath, raw && t.isNode(raw) ? raw : null))
    return []
  }

  const options: SourceFieldOption[] = []
  raw.elements.forEach((element, index) => {
    if (!element || !t.isObjectExpression(element)) {
      diagnostics.push(diagnostic('error', 'source-field-option-object', 'Каждый option должен быть объектом { value, label? }.', `${sourcePath}.${index}`, element))
      return
    }
    const valueNode = readProperty(element, 'value')
    const labelNode = readProperty(element, 'label')
    const value = primitiveLiteral(valueNode)
    const label = labelNode && t.isStringLiteral(labelNode) ? labelNode.value : undefined
    if (value == null && !t.isNullLiteral(valueNode)) {
      diagnostics.push(diagnostic('error', 'source-field-option-value', 'option.value должен быть string, number или boolean.', `${sourcePath}.${index}.value`, valueNode))
      return
    }
    if (value === null) {
      diagnostics.push(diagnostic('error', 'source-field-option-null', 'option.value не может быть null.', `${sourcePath}.${index}.value`, valueNode))
      return
    }
    options.push({ value, label })
  })
  return options
}

function readVocab(
  call: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
) {
  const identity = readStringArgument(call, 0)
  const config = call.arguments[1]
  if (!identity || !config || !t.isObjectExpression(config)) {
    diagnostics.push(diagnostic('error', 'source-field-vocab-shape', '.vocab(identity, { valuePath, labelPath }) требует identity и config.', sourcePath, call))
    return null
  }

  const valuePath = stringProperty(config, 'valuePath')
  const labelPath = stringProperty(config, 'labelPath')
  if (!valuePath || !labelPath) {
    diagnostics.push(diagnostic('error', 'source-field-vocab-paths', 'vocab config требует valuePath и labelPath.', sourcePath, config))
    return null
  }
  return { identity, valuePath, labelPath }
}

function readDefaultSource(
  raw: t.CallExpression['arguments'][number] | undefined,
  source: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): SourceFieldDefaultSource | null {
  if (!raw || !t.isExpression(raw)) {
    diagnostics.push(diagnostic('error', 'source-field-from-missing', '.from(...) требует Filter output reference.', sourcePath))
    return null
  }

  const expression = unwrapExpression(raw)
  if (!t.isCallExpression(expression) || !t.isMemberExpression(expression.callee) || propertyName(expression.callee.property) !== 'output') {
    diagnostics.push(diagnostic('error', 'source-field-from-output', '.from(...) поддерживает filter(...).output(...) или defineFilter(...).output(...).', sourcePath, expression))
    return null
  }

  const output = readStringArgument(expression, 0)
  const base = t.isExpression(expression.callee.object) ? unwrapExpression(expression.callee.object) : null
  if (!output || !base || !t.isCallExpression(base) || !t.isIdentifier(base.callee)) {
    diagnostics.push(diagnostic('error', 'source-field-from-shape', 'Не удалось прочитать Filter output reference.', sourcePath, expression))
    return null
  }

  if (base.callee.name === 'filter') {
    const identity = readStringArgument(base, 0)
    if (identity)
      return { kind: 'filter', identity, output }
  }

  if (base.callee.name === 'defineFilter' && typeof base.start === 'number' && typeof base.end === 'number')
    return { kind: 'inline-filter', source: source.slice(base.start, base.end), output }

  diagnostics.push(diagnostic('error', 'source-field-from-unsupported', '.from(...) поддерживает только Filter output reference.', sourcePath, expression))
  return null
}

function validateLiteralDefault(
  field: SourceFieldDefinition,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  node: t.Node,
): void {
  const expression = field.defaultValue
  if (!expression || !isStaticExpression(expression))
    return

  const value = staticExpressionValue(expression)
  if (value == null)
    return
  const valid = field.array
    ? Array.isArray(value) && value.every(item => isScalarValue(field.type, item))
    : field.type === 'String' || field.type === 'Date' || field.type === 'Time' || field.type === 'DateTime'
      ? typeof value === 'string'
      : field.type === 'Number'
        ? typeof value === 'number'
        : field.type === 'Boolean'
          ? typeof value === 'boolean'
          : typeof value === 'object'

  if (!valid)
    diagnostics.push(diagnostic('error', 'source-field-default-type', `Default поля "${field.key}" не соответствует типу ${field.type}${field.array ? '[]' : ''}.`, `${sourcePath}.default`, node))
}

function isStaticExpression(expression: import('@/domain/types/source/source-expression.types').SourceExpressionIR): boolean {
  if (expression.type === 'literal')
    return true
  if (expression.type === 'array')
    return expression.items.every(isStaticExpression)
  if (expression.type === 'object')
    return Object.values(expression.properties).every(isStaticExpression)
  return false
}

function staticExpressionValue(expression: import('@/domain/types/source/source-expression.types').SourceExpressionIR): unknown {
  if (expression.type === 'literal')
    return expression.value
  if (expression.type === 'array')
    return expression.items.map(staticExpressionValue)
  if (expression.type === 'object')
    return Object.fromEntries(Object.entries(expression.properties).map(([key, value]) => [key, staticExpressionValue(value)]))
  return undefined
}

function isScalarValue(type: SourceFieldType, value: unknown): boolean {
  if (value == null)
    return false
  if (type === 'String' || type === 'Date' || type === 'Time' || type === 'DateTime')
    return typeof value === 'string'
  if (type === 'Number')
    return typeof value === 'number'
  if (type === 'Boolean')
    return typeof value === 'boolean'
  return typeof value === 'object' && !Array.isArray(value)
}

function readProperty(node: t.ObjectExpression, name: string): t.Expression | null {
  for (const property of node.properties) {
    if (t.isObjectProperty(property) && !property.computed && propertyName(property.key) === name && t.isExpression(property.value))
      return unwrapExpression(property.value)
  }
  return null
}

function stringProperty(node: t.ObjectExpression, name: string): string | null {
  const value = readProperty(node, name)
  return value && t.isStringLiteral(value) ? value.value : null
}

function primitiveLiteral(node: t.Expression | null): string | number | boolean | null {
  if (!node)
    return null
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
    return node.value
  if (t.isNullLiteral(node))
    return null
  return null
}
