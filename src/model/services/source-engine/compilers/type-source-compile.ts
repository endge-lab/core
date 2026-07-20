import type {
  TypeSourceCompileResult,
  TypeSourceDefinition,
  TypeSourceExpression,
  TypeSourceField,
  TypeSourceObjectDefinition,
  TypeSourceReference,
} from '@/domain/types/source/type-source.types'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import {
  diagnostic,
  propertyName,
  unwrapExpression,
} from '@/model/services/source-engine/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>
type StaticValueResult = { ok: true, value: unknown } | { ok: false }

/** Компилирует Type Source v1 без выполнения пользовательского JavaScript. */
export function compileTypeSource(source: string, sourceVersion = 1): TypeSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []

  // Existing legacy records intentionally have no source during the transition.
  if (!String(source ?? '').trim())
    return { ast: null, document: null, artifact: null, diagnostics }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = readRootDefineType(ast, diagnostics)
    if (!call)
      return { ast, document: null, artifact: null, diagnostics }

    if (call.arguments.length !== 1 || !isExpressionArgument(call.arguments[0])) {
      diagnostics.push(diagnostic('error', 'type-source-define-arity', 'defineType принимает ровно одно type definition.', 'defineType', call))
      return { ast, document: null, artifact: null, diagnostics }
    }

    const definition = readDefinition(unwrapExpression(call.arguments[0]), diagnostics)
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    const document = definition && !hasErrors ? { definition } : null
    const artifact = definition && !hasErrors
      ? { type: 'type' as const, sourceVersion, definition }
      : null

    return { ast, document, artifact, diagnostics }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'type-source-parse-error', `Не удалось распарсить Type source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, diagnostics }
  }
}

function readRootDefineType(ast: t.File, diagnostics: DiagnosticDraft[]): t.CallExpression | null {
  if (ast.program.body.length !== 1) {
    diagnostics.push(diagnostic('error', 'type-source-root', 'Type source должен содержать только один вызов defineType(...).'))
    return null
  }

  const statement = ast.program.body[0]
  if (!t.isExpressionStatement(statement)) {
    diagnostics.push(diagnostic('error', 'type-source-root', 'Type source должен содержать только один вызов defineType(...).', 'defineType', statement))
    return null
  }

  const expression = unwrapExpression(statement.expression)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'defineType' })) {
    diagnostics.push(diagnostic('error', 'type-source-define-missing', 'Type source должен начинаться с defineType(...).', 'defineType', statement))
    return null
  }
  return expression
}

function readDefinition(node: t.Expression, diagnostics: DiagnosticDraft[], sourcePath = 'defineType'): TypeSourceDefinition | null {
  if (t.isObjectExpression(node))
    return readObjectDefinition(node, diagnostics)

  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee)) {
    diagnostics.push(diagnostic('error', 'type-source-definition', `${sourcePath} поддерживает object, objectOf(...), enumOf(...), unionOf(...) или arrayOf(...).`, sourcePath, node))
    return null
  }

  switch (node.callee.name) {
    case 'objectOf':
      return readObjectOfDefinition(node, diagnostics, sourcePath)
    case 'enumOf':
      return readEnumDefinition(node, diagnostics)
    case 'unionOf':
      return readUnionDefinition(node, diagnostics)
    case 'arrayOf':
      return readArrayDefinition(node, diagnostics)
    default:
      diagnostics.push(diagnostic('error', 'type-source-definition', `Функция ${node.callee.name}(...) не поддерживается в ${sourcePath}.`, sourcePath, node))
      return null
  }
}

function readObjectDefinition(node: t.ObjectExpression, diagnostics: DiagnosticDraft[]): TypeSourceObjectDefinition {
  const fields: TypeSourceField[] = []
  const declared = new Set<string>()

  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !isExpressionArgument(property.value)) {
      diagnostics.push(diagnostic('error', 'type-source-field-property', 'Object type допускает только обычные properties без spread и computed keys.', 'fields', property))
      continue
    }

    const key = propertyName(property.key)
    if (!key) {
      diagnostics.push(diagnostic('error', 'type-source-field-name', 'Не удалось определить имя поля.', 'fields', property))
      continue
    }
    if (declared.has(key)) {
      diagnostics.push(diagnostic('error', 'type-source-field-duplicate', `Поле "${key}" объявлено повторно.`, key, property))
      continue
    }
    declared.add(key)

    const field = readField(key, property.value, diagnostics)
    if (field)
      fields.push(field)
  }

  return { kind: 'object', fields }
}

function readObjectOfDefinition(
  call: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): TypeSourceObjectDefinition | null {
  const arg = call.arguments[0]
  if (call.arguments.length !== 1 || !arg || !t.isObjectExpression(arg)) {
    diagnostics.push(diagnostic('error', 'type-source-object-shape', 'objectOf принимает ровно один object literal.', sourcePath, call))
    return null
  }
  return readObjectDefinition(arg, diagnostics)
}

function readField(key: string, raw: t.Expression, diagnostics: DiagnosticDraft[]): TypeSourceField | null {
  let cursor = unwrapExpression(raw)
  const field: Omit<TypeSourceField, 'type'> & { type?: TypeSourceExpression } = {
    key,
    optional: false,
    array: false,
    examples: [],
  }
  const singleModifiers = new Set<string>()

  while (t.isCallExpression(cursor) && t.isMemberExpression(cursor.callee) && t.isExpression(cursor.callee.object)) {
    const method = propertyName(cursor.callee.property)
    if (!method) {
      diagnostics.push(diagnostic('error', 'type-source-field-modifier', `Поле "${key}" содержит неизвестный modifier.`, key, cursor))
      return null
    }

    if (method !== 'example' && singleModifiers.has(method)) {
      diagnostics.push(diagnostic('error', 'type-source-field-modifier-duplicate', `Modifier .${method}(...) для поля "${key}" указан повторно.`, `${key}.${method}`, cursor))
    }
    singleModifiers.add(method)
    applyFieldModifier(field, method, cursor, diagnostics)
    cursor = unwrapExpression(cursor.callee.object)
  }

  if (!t.isCallExpression(cursor) || !t.isIdentifier(cursor.callee, { name: 'field' })) {
    diagnostics.push(diagnostic('error', 'type-source-field-shape', `Поле "${key}" должно начинаться с field('Type') или field(objectOf(...)).`, key, raw))
    return null
  }

  const fieldType = readFieldType(cursor, diagnostics, key)
  if (!fieldType)
    return null
  field.type = fieldType

  if ((field.min != null || field.max != null) && !(fieldType.kind === 'reference' && fieldType.identity === 'Number')) {
    diagnostics.push(diagnostic('error', 'type-source-field-range-type', `.min/.max разрешены только для field('Number'), поле "${key}" имеет другой type expression.`, key, raw))
  }
  if (field.min != null && field.max != null && field.min > field.max) {
    diagnostics.push(diagnostic('error', 'type-source-field-range', `Для поля "${key}" min не может быть больше max.`, key, raw))
  }

  return field as TypeSourceField
}

function readFieldType(
  call: t.CallExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): TypeSourceExpression | null {
  if (call.arguments.length !== 1 || !isExpressionArgument(call.arguments[0])) {
    diagnostics.push(diagnostic('error', 'type-source-field-arity', 'field принимает ровно одну ссылку или type expression.', sourcePath, call))
    return null
  }

  const arg = unwrapExpression(call.arguments[0])
  if (t.isStringLiteral(arg)) {
    const identity = arg.value.trim()
    if (!identity) {
      diagnostics.push(diagnostic('error', 'type-source-reference-identity', 'field(...) принимает непустую строку identity.', sourcePath, call))
      return null
    }
    return { kind: 'reference', identity }
  }

  return readTypeExpression(arg, diagnostics, sourcePath)
}

function applyFieldModifier(
  field: Omit<TypeSourceField, 'type'> & { type?: TypeSourceExpression },
  method: string,
  call: t.CallExpression,
  diagnostics: DiagnosticDraft[],
): void {
  const path = `${field.key}.${method}`
  if (method === 'array' || method === 'optional') {
    if (call.arguments.length !== 0)
      diagnostics.push(diagnostic('error', 'type-source-field-modifier-arity', `.${method}() не принимает аргументы.`, path, call))
    field[method] = true
    return
  }

  if (method === 'description') {
    const value = readStringCallArgument(call)
    if (value == null)
      diagnostics.push(diagnostic('error', 'type-source-field-description', '.description(...) принимает одну строку.', path, call))
    else
      field.description = value
    return
  }

  if (method === 'min' || method === 'max') {
    const value = readNumberCallArgument(call)
    if (value == null)
      diagnostics.push(diagnostic('error', 'type-source-field-range-value', `.${method}(...) принимает одно конечное число.`, path, call))
    else
      field[method] = value
    return
  }

  if (method === 'example') {
    if (call.arguments.length !== 1 || !isExpressionArgument(call.arguments[0])) {
      diagnostics.push(diagnostic('error', 'type-source-field-example', '.example(...) принимает одно static JSON value.', path, call))
      return
    }
    const value = readStaticValue(call.arguments[0], diagnostics, path)
    if (value.ok)
      field.examples.push(value.value)
    return
  }

  diagnostics.push(diagnostic('error', 'type-source-field-modifier-unsupported', `Modifier .${method}(...) не поддерживается Type Source v1.`, path, call))
}

function readEnumDefinition(call: t.CallExpression, diagnostics: DiagnosticDraft[]): TypeSourceDefinition | null {
  const arg = call.arguments[0]
  if (call.arguments.length !== 1 || !arg || !t.isArrayExpression(arg)) {
    diagnostics.push(diagnostic('error', 'type-source-enum-shape', 'enumOf принимает один непустой array literal.', 'enumOf', call))
    return null
  }

  const values: Array<string | number | boolean> = []
  for (let index = 0; index < arg.elements.length; index++) {
    const element = arg.elements[index]
    if (!element || !isExpressionArgument(element)) {
      diagnostics.push(diagnostic('error', 'type-source-enum-value', 'enumOf допускает только string, number или boolean literals.', `enumOf.${index}`, element ?? arg))
      continue
    }
    const value = readStaticValue(element, diagnostics, `enumOf.${index}`)
    if (!value.ok || !['string', 'number', 'boolean'].includes(typeof value.value)) {
      diagnostics.push(diagnostic('error', 'type-source-enum-value', 'enumOf допускает только string, number или boolean literals.', `enumOf.${index}`, element))
      continue
    }
    values.push(value.value as string | number | boolean)
  }

  if (values.length === 0)
    diagnostics.push(diagnostic('error', 'type-source-enum-empty', 'enumOf не может быть пустым.', 'enumOf', call))
  const kinds = new Set(values.map(value => typeof value))
  if (kinds.size > 1)
    diagnostics.push(diagnostic('error', 'type-source-enum-mixed', 'Все значения enumOf должны иметь один primitive type.', 'enumOf', call))
  if (new Set(values.map(value => `${typeof value}:${String(value)}`)).size !== values.length)
    diagnostics.push(diagnostic('error', 'type-source-enum-duplicate', 'enumOf содержит повторяющиеся значения.', 'enumOf', call))

  return { kind: 'enum', values }
}

function readUnionDefinition(call: t.CallExpression, diagnostics: DiagnosticDraft[]): TypeSourceDefinition {
  const variants = call.arguments
    .map((arg, index) => isExpressionArgument(arg) ? readTypeExpression(arg, diagnostics, `unionOf.${index}`) : null)
    .filter((item): item is TypeSourceExpression => item != null)

  if (call.arguments.length < 2)
    diagnostics.push(diagnostic('error', 'type-source-union-arity', 'unionOf требует минимум два type expression.', 'unionOf', call))
  if (new Set(variants.map(item => JSON.stringify(item))).size !== variants.length)
    diagnostics.push(diagnostic('error', 'type-source-union-duplicate', 'unionOf содержит повторяющиеся типы.', 'unionOf', call))

  return { kind: 'union', variants }
}

function readArrayDefinition(call: t.CallExpression, diagnostics: DiagnosticDraft[]): TypeSourceDefinition | null {
  if (call.arguments.length !== 1 || !isExpressionArgument(call.arguments[0])) {
    diagnostics.push(diagnostic('error', 'type-source-array-arity', 'arrayOf принимает ровно один type expression.', 'arrayOf', call))
    return null
  }
  const items = readTypeExpression(call.arguments[0], diagnostics, 'arrayOf')
  return items ? { kind: 'array', items } : null
}

function readTypeExpression(
  raw: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): TypeSourceExpression | null {
  const node = unwrapExpression(raw)
  if (t.isCallExpression(node) && t.isIdentifier(node.callee, { name: 'type' }))
    return readReferenceCall(node, 'type', diagnostics, sourcePath)
  if (t.isObjectExpression(node)) {
    diagnostics.push(diagnostic('error', 'type-source-object-wrapper', `${sourcePath}: inline object должен быть обёрнут в objectOf({...}).`, sourcePath, node))
    return null
  }

  return readDefinition(node, diagnostics, sourcePath)
}

function readReferenceCall(
  raw: t.Expression,
  callee: 'field' | 'type',
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): TypeSourceReference | null {
  const node = unwrapExpression(raw)
  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee, { name: callee })) {
    diagnostics.push(diagnostic('error', 'type-source-reference', `${sourcePath} должен использовать ${callee}('Type').`, sourcePath, node))
    return null
  }
  const identity = readStringCallArgument(node)?.trim()
  if (!identity) {
    diagnostics.push(diagnostic('error', 'type-source-reference-identity', `${callee}(...) принимает одну непустую строку identity.`, sourcePath, node))
    return null
  }
  return { kind: 'reference', identity }
}

function readStringCallArgument(call: t.CallExpression): string | null {
  if (call.arguments.length !== 1)
    return null
  const arg = call.arguments[0]
  return arg && t.isStringLiteral(arg) ? arg.value : null
}

function readNumberCallArgument(call: t.CallExpression): number | null {
  if (call.arguments.length !== 1 || !isExpressionArgument(call.arguments[0]))
    return null
  const value = staticNumber(call.arguments[0])
  return value != null && Number.isFinite(value) ? value : null
}

function readStaticValue(node: t.Expression, diagnostics: DiagnosticDraft[], sourcePath: string): StaticValueResult {
  const value = unwrapExpression(node)
  if (t.isStringLiteral(value) || t.isNumericLiteral(value) || t.isBooleanLiteral(value))
    return { ok: true, value: value.value }
  if (t.isNullLiteral(value))
    return { ok: true, value: null }
  const number = staticNumber(value)
  if (number != null)
    return { ok: true, value: number }

  if (t.isArrayExpression(value)) {
    const items: unknown[] = []
    for (let index = 0; index < value.elements.length; index++) {
      const element = value.elements[index]
      if (!element || !isExpressionArgument(element)) {
        diagnostics.push(diagnostic('error', 'type-source-static-array', 'Static array не поддерживает holes или spread.', `${sourcePath}.${index}`, element ?? value))
        return { ok: false }
      }
      const item = readStaticValue(element, diagnostics, `${sourcePath}.${index}`)
      if (!item.ok)
        return item
      items.push(item.value)
    }
    return { ok: true, value: items }
  }

  if (t.isObjectExpression(value)) {
    const result: Record<string, unknown> = {}
    for (const property of value.properties) {
      if (!t.isObjectProperty(property) || property.computed || !isExpressionArgument(property.value)) {
        diagnostics.push(diagnostic('error', 'type-source-static-object', 'Static object допускает только обычные properties.', sourcePath, property))
        return { ok: false }
      }
      const key = propertyName(property.key)
      if (!key) {
        diagnostics.push(diagnostic('error', 'type-source-static-key', 'Не удалось определить static object key.', sourcePath, property))
        return { ok: false }
      }
      const item = readStaticValue(property.value, diagnostics, `${sourcePath}.${key}`)
      if (!item.ok)
        return item
      result[key] = item.value
    }
    return { ok: true, value: result }
  }

  diagnostics.push(diagnostic('error', 'type-source-static-value', 'Ожидается static JSON value; вызовы функций и identifiers не выполняются.', sourcePath, value))
  return { ok: false }
}

function staticNumber(node: t.Expression): number | null {
  const value = unwrapExpression(node)
  if (t.isNumericLiteral(value))
    return value.value
  if (t.isUnaryExpression(value) && (value.operator === '-' || value.operator === '+') && t.isNumericLiteral(value.argument))
    return value.operator === '-' ? -value.argument.value : value.argument.value
  return null
}

function isExpressionArgument(node: t.Node | null | undefined): node is t.Expression {
  return node != null && t.isExpression(node)
}
