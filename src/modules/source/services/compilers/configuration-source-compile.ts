import type { ProgramDiagnostic } from '@/modules/program/domain/types/program.types'
import type {
  ConfigurationSourceCompileResult,
  ConfigurationSourceValueDefinition,
  EndgeJSONValue,
} from '@/modules/source/domain/types/configuration-source.types'
import type { TypeProgramCatalogEntry } from '@/modules/source/domain/types/type-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { inferConfigurationDefault, isEndgeJSONValue, validateConfigurationValue } from '@/modules/configuration/domain/configuration-value'
import { diagnostic, propertyName, unwrapExpression } from '@/modules/source/services/compilers/source-expression-compile'
import { compileTypeSourceExpression } from '@/modules/source/services/compilers/type-source-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Parses Configuration Source v1 without executing authored JavaScript. */
export function compileConfigurationSource(
  source: string,
  catalog: readonly TypeProgramCatalogEntry[] = [],
): ConfigurationSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = readRoot(ast, diagnostics)
    if (!call) {
      return { ast, document: null, diagnostics }
    }
    const argument = call.arguments[0]
    if (call.arguments.length !== 1 || !argument || !t.isObjectExpression(argument)) {
      diagnostics.push(diagnostic('error', 'configuration-source-shape', 'defineConfig принимает ровно один object literal.', 'defineConfig', call))
      return { ast, document: null, diagnostics }
    }

    const values: ConfigurationSourceValueDefinition[] = []
    const seen = new Set<string>()
    for (const property of argument.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'configuration-source-property', 'Configuration допускает только обычные properties без spread и computed keys.', 'defineConfig', property))
        continue
      }
      const key = propertyName(property.key)
      if (!key || isReservedKey(key)) {
        diagnostics.push(diagnostic('error', 'configuration-source-key', `Некорректное имя настройки "${key ?? ''}".`, 'defineConfig', property))
        continue
      }
      if (seen.has(key)) {
        diagnostics.push(diagnostic('error', 'configuration-source-duplicate', `Настройка "${key}" объявлена повторно.`, key, property))
        continue
      }
      seen.add(key)
      const value = readValue(key, property.value, catalog, diagnostics)
      if (value) {
        values.push(value)
      }
    }

    const draftDocument = { values }
    return {
      ast,
      document: diagnostics.some(item => item.severity === 'error') ? null : draftDocument,
      draftDocument,
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'configuration-source-parse-error', `Не удалось распарсить Configuration source: ${error?.message ?? error}`))
    return { ast: null, document: null, diagnostics }
  }
}

function readRoot(ast: t.File, diagnostics: DiagnosticDraft[]): t.CallExpression | null {
  if (ast.program.body.length !== 1 || !t.isExpressionStatement(ast.program.body[0])) {
    diagnostics.push(diagnostic('error', 'configuration-source-root', 'Configuration source должен содержать только defineConfig(...).'))
    return null
  }
  const expression = unwrapExpression(ast.program.body[0].expression)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'defineConfig' })) {
    diagnostics.push(diagnostic('error', 'configuration-source-root', 'Configuration source должен начинаться с defineConfig(...).'))
    return null
  }
  return expression
}

function readValue(
  key: string,
  raw: t.Expression,
  catalog: readonly TypeProgramCatalogEntry[],
  diagnostics: DiagnosticDraft[],
): ConfigurationSourceValueDefinition | null {
  let cursor = unwrapExpression(raw)
  const modifiers = new Map<string, t.CallExpression>()
  while (t.isCallExpression(cursor) && t.isMemberExpression(cursor.callee) && t.isExpression(cursor.callee.object)) {
    const name = propertyName(cursor.callee.property)
    if (!name || !['label', 'description', 'min', 'max', 'step'].includes(name)) {
      diagnostics.push(diagnostic('error', 'configuration-value-modifier', `Неизвестный modifier настройки "${key}".`, key, cursor))
      return null
    }
    if (modifiers.has(name)) {
      diagnostics.push(diagnostic('error', 'configuration-value-modifier-duplicate', `Modifier .${name} указан повторно.`, `${key}.${name}`, cursor))
    }
    modifiers.set(name, cursor)
    cursor = unwrapExpression(cursor.callee.object)
  }

  if (!t.isCallExpression(cursor) || !t.isIdentifier(cursor.callee, { name: 'value' }) || cursor.arguments.length < 1 || cursor.arguments.length > 2) {
    diagnostics.push(diagnostic('error', 'configuration-value-shape', `Настройка "${key}" должна использовать value(Type, default?).`, key, raw))
    return null
  }
  const typeArgument = cursor.arguments[0]
  if (!typeArgument || !t.isExpression(typeArgument)) {
    diagnostics.push(diagnostic('error', 'configuration-value-type', `Настройка "${key}" не содержит Type expression.`, key, cursor))
    return null
  }
  const type = compileTypeSourceExpression(typeArgument, diagnostics, `${key}.type`)
  if (!type) {
    return null
  }

  let defaultValue: EndgeJSONValue
  let defaultWasInferred = false
  const defaultArgument = cursor.arguments[1]
  if (defaultArgument && t.isExpression(defaultArgument)) {
    const value = readStaticJSON(defaultArgument, diagnostics, `${key}.default`)
    if (!value.ok) {
      return null
    }
    defaultValue = value.value
  }
  else {
    const inferred = inferConfigurationDefault(type, catalog)
    if (!inferred.ok) {
      diagnostics.push(diagnostic('error', 'configuration-default-required', inferred.reason, `${key}.default`, cursor))
      return null
    }
    defaultValue = inferred.value
    defaultWasInferred = true
  }

  diagnostics.push(...validateConfigurationValue(type, defaultValue, catalog, `${key}.default`).diagnostics)
  const label = readStringModifier(modifiers.get('label'), key, diagnostics) ?? humanize(key)
  const description = readStringModifier(modifiers.get('description'), key, diagnostics) ?? undefined
  const min = readNumberModifier(modifiers.get('min'), key, diagnostics)
  const max = readNumberModifier(modifiers.get('max'), key, diagnostics)
  const step = readNumberModifier(modifiers.get('step'), key, diagnostics)
  if (min != null && max != null && min > max) {
    diagnostics.push(diagnostic('error', 'configuration-range-invalid', 'min не может быть больше max.', key, raw))
  }
  if ((min != null || max != null || step != null) && !(type.kind === 'reference' && type.identity === 'Number')) {
    diagnostics.push(diagnostic('error', 'configuration-number-modifier-type', 'min/max/step разрешены только для Number.', key, raw))
  }
  if (step != null && step <= 0) {
    diagnostics.push(diagnostic('error', 'configuration-step-invalid', 'step должен быть больше нуля.', `${key}.step`, raw))
  }

  return { key, type, defaultValue, defaultWasInferred, label, description, min, max, step }
}

function readStaticJSON(node: t.Expression, diagnostics: DiagnosticDraft[], path: string): { ok: true, value: EndgeJSONValue } | { ok: false } {
  const value = unwrapExpression(node)
  if (t.isStringLiteral(value) || t.isNumericLiteral(value) || t.isBooleanLiteral(value)) {
    return { ok: true, value: value.value }
  }
  if (t.isNullLiteral(value)) {
    return { ok: true, value: null }
  }
  if (t.isUnaryExpression(value) && (value.operator === '-' || value.operator === '+') && t.isNumericLiteral(value.argument)) {
    return { ok: true, value: value.operator === '-' ? -value.argument.value : value.argument.value }
  }
  if (t.isArrayExpression(value)) {
    const result: EndgeJSONValue[] = []
    for (let index = 0; index < value.elements.length; index++) {
      const item = value.elements[index]
      if (!item || !t.isExpression(item)) {
        diagnostics.push(diagnostic('error', 'configuration-static-array', 'JSON array не поддерживает holes или spread.', `${path}.${index}`, item ?? value))
        return { ok: false }
      }
      const parsed = readStaticJSON(item, diagnostics, `${path}.${index}`)
      if (!parsed.ok) {
        return parsed
      }
      result.push(parsed.value)
    }
    return { ok: true, value: result }
  }
  if (t.isObjectExpression(value)) {
    const result: Record<string, EndgeJSONValue> = {}
    for (const property of value.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'configuration-static-object', 'JSON object допускает только обычные properties.', path, property))
        return { ok: false }
      }
      const key = propertyName(property.key)
      if (!key || isReservedKey(key)) {
        diagnostics.push(diagnostic('error', 'configuration-static-key', 'JSON object содержит небезопасный key.', path, property))
        return { ok: false }
      }
      const parsed = readStaticJSON(property.value, diagnostics, `${path}.${key}`)
      if (!parsed.ok) {
        return parsed
      }
      result[key] = parsed.value
    }
    if (!isEndgeJSONValue(result)) {
      return { ok: false }
    }
    return { ok: true, value: result }
  }
  diagnostics.push(diagnostic('error', 'configuration-static-value', 'Default должен быть static JSON value.', path, value))
  return { ok: false }
}

function readStringModifier(call: t.CallExpression | undefined, key: string, diagnostics: DiagnosticDraft[]): string | null {
  if (!call) {
    return null
  }
  const argument = call.arguments[0]
  if (call.arguments.length !== 1 || !argument || !t.isStringLiteral(argument)) {
    diagnostics.push(diagnostic('error', 'configuration-string-modifier', 'Modifier принимает одну строку.', key, call))
    return null
  }
  return argument.value.trim()
}

function readNumberModifier(call: t.CallExpression | undefined, key: string, diagnostics: DiagnosticDraft[]): number | undefined {
  if (!call) {
    return undefined
  }
  const argument = call.arguments[0]
  const parsed = argument && t.isExpression(argument) ? readStaticJSON(argument, diagnostics, key) : { ok: false as const }
  if (!parsed.ok || typeof parsed.value !== 'number') {
    diagnostics.push(diagnostic('error', 'configuration-number-modifier', 'Modifier принимает одно число.', key, call))
    return undefined
  }
  return parsed.value
}

function humanize(value: string): string {
  const text = value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim()
  return text ? text[0].toUpperCase() + text.slice(1) : value
}

function isReservedKey(key: string): boolean {
  return key === '__proto__' || key === 'prototype' || key === 'constructor'
}
