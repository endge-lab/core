import type { DataViewRef } from '@/domain/types/data-view-source.types'
import type { ProgramDiagnostic } from '@/domain/types/program.types'
import type { StoreDataDescriptor, StoreSourceCompileResult } from '@/domain/types/store-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { diagnostic, propertyName, readStringArgument, unwrapExpression } from '@/model/services/source-engine/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует Store source v1 в data graph без запуска runtime. */
export function compileStoreSource(source: string, sourceVersion = 1): StoreSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  if (!String(source ?? '').trim()) {
    diagnostics.push(diagnostic('error', 'store-source-empty', 'Store source пуст.'))
    return { ast: null, document: null, artifact: null, diagnostics }
  }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineStore(ast)
    const definition = call?.arguments[0]
    if (!call) {
      diagnostics.push(diagnostic('error', 'store-source-define-missing', 'Store source должен содержать defineStore({...}).'))
      return { ast, document: null, artifact: null, diagnostics }
    }
    if (!definition || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'store-source-definition', 'defineStore принимает объектный литерал.', 'defineStore', call))
      return { ast, document: null, artifact: null, diagnostics }
    }

    let dataNode: t.ObjectExpression | null = null
    for (const property of definition.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'store-source-property', 'defineStore допускает только обычные properties.', 'defineStore', property))
        continue
      }
      const name = propertyName(property.key)
      if (name !== 'data') {
        diagnostics.push(diagnostic('error', 'store-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Store v1.`, name ?? 'defineStore', property))
        continue
      }
      const value = unwrapExpression(property.value)
      if (!t.isObjectExpression(value))
        diagnostics.push(diagnostic('error', 'store-source-data-object', 'data должен быть object literal.', 'data', value))
      else
        dataNode = value
    }
    if (!dataNode)
      diagnostics.push(diagnostic('error', 'store-source-data-missing', 'defineStore требует поле data.', 'data', definition))

    const data = dataNode ? readData(dataNode, source, diagnostics) : []
    const document = { data }
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : { type: 'store', sourceVersion, ...document },
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'store-source-parse-error', `Не удалось распарсить Store source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, diagnostics }
  }
}

function readData(node: t.ObjectExpression, source: string, diagnostics: DiagnosticDraft[]): StoreDataDescriptor[] {
  const descriptors: StoreDataDescriptor[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'store-data-property', 'data допускает только обычные properties.', 'data', property))
      continue
    }
    const key = propertyName(property.key)
    if (!key)
      continue
    if (declared.has(key)) {
      diagnostics.push(diagnostic('error', 'store-data-duplicate', `Data field "${key}" объявлен повторно.`, `data.${key}`, property))
      continue
    }
    const expression = unwrapExpression(property.value)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'value' })) {
      const initialNode = expression.arguments[0]
      if (!initialNode || !t.isExpression(initialNode)) {
        diagnostics.push(diagnostic('error', 'store-value-initial', `value(...) для "${key}" требует initial value.`, `data.${key}`, expression))
        continue
      }
      const initial = readStaticValue(initialNode)
      if (!initial.ok) {
        diagnostics.push(diagnostic('error', 'store-value-static', `value(...) для "${key}" принимает JSON-compatible значение.`, `data.${key}`, initialNode))
        continue
      }
      descriptors.push({ key, kind: 'value', initial: initial.value })
      declared.add(key)
      continue
    }

    const chain = memberChain(expression)
    if (!chain || !t.isIdentifier(chain.base.callee, { name: 'derived' })) {
      diagnostics.push(diagnostic('error', 'store-data-shape', `Data field "${key}" должен быть value(...) или derived().from(...).`, `data.${key}`, expression))
      continue
    }
    let sourceKey = ''
    const dataViews: DataViewRef[] = []
    for (const modifier of chain.modifiers) {
      if (modifier.name === 'from') {
        sourceKey = readStringArgument(modifier.call, 0) ?? ''
        continue
      }
      if (modifier.name === 'dataView') {
        const ref = readDataViewRef(modifier.call.arguments[0], source, diagnostics, `data.${key}.dataView`)
        if (ref)
          dataViews.push(ref)
        continue
      }
      diagnostics.push(diagnostic('error', 'store-derived-method', `derived().${modifier.name}(...) не поддерживается.`, `data.${key}`, modifier.call))
    }
    if (!sourceKey) {
      diagnostics.push(diagnostic('error', 'store-derived-source', `derived field "${key}" требует .from(field).`, `data.${key}`, expression))
      continue
    }
    if (!declared.has(sourceKey)) {
      diagnostics.push(diagnostic('error', 'store-derived-forward-reference', `Derived field "${key}" ссылается на "${sourceKey}", который не объявлен выше.`, `data.${key}.from`, expression))
      continue
    }
    if (!dataViews.length) {
      diagnostics.push(diagnostic('error', 'store-derived-transform', `Derived field "${key}" требует хотя бы один .dataView(...).`, `data.${key}`, expression))
      continue
    }
    descriptors.push({ key, kind: 'derived', source: sourceKey, dataViews })
    declared.add(key)
  }
  return descriptors
}

function readDataViewRef(
  raw: t.CallExpression['arguments'][number] | undefined,
  source: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): DataViewRef | null {
  if (!raw || !t.isExpression(raw)) {
    diagnostics.push(diagnostic('error', 'store-dataview-missing', '.dataView(...) требует DataView.', sourcePath))
    return null
  }
  const expression = unwrapExpression(raw)
  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'dataView' })) {
    const identity = readStringArgument(expression, 0)
    if (identity)
      return { kind: 'external', identity }
  }
  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineDataView' }) && expression.start != null && expression.end != null)
    return { kind: 'inline', source: source.slice(expression.start, expression.end) }

  diagnostics.push(diagnostic('error', 'store-dataview-shape', '.dataView(...) поддерживает dataView(identity) или defineDataView({...}).', sourcePath, expression))
  return null
}

function findDefineStore(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineStore' }))
      return expression
  }
  return null
}

function memberChain(raw: t.Expression): { base: t.CallExpression, modifiers: Array<{ name: string, call: t.CallExpression }> } | null {
  let current = unwrapExpression(raw)
  const modifiers: Array<{ name: string, call: t.CallExpression }> = []
  while (t.isCallExpression(current) && t.isMemberExpression(current.callee)) {
    const name = propertyName(current.callee.property)
    if (!name || !t.isExpression(current.callee.object))
      return null
    modifiers.unshift({ name, call: current })
    current = unwrapExpression(current.callee.object)
  }
  return t.isCallExpression(current) ? { base: current, modifiers } : null
}

function readStaticValue(node: t.Expression): { ok: true, value: unknown } | { ok: false } {
  const value = unwrapExpression(node)
  if (t.isStringLiteral(value) || t.isBooleanLiteral(value) || t.isNumericLiteral(value))
    return { ok: true, value: value.value }
  if (t.isNullLiteral(value))
    return { ok: true, value: null }
  if (t.isUnaryExpression(value, { operator: '-' }) && t.isNumericLiteral(value.argument))
    return { ok: true, value: -value.argument.value }
  if (t.isArrayExpression(value)) {
    const out: unknown[] = []
    for (const element of value.elements) {
      if (!element || !t.isExpression(element))
        return { ok: false }
      const item = readStaticValue(element)
      if (!item.ok)
        return item
      out.push(item.value)
    }
    return { ok: true, value: out }
  }
  if (t.isObjectExpression(value)) {
    const out: Record<string, unknown> = {}
    for (const property of value.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value))
        return { ok: false }
      const key = propertyName(property.key)
      if (!key)
        return { ok: false }
      const item = readStaticValue(property.value)
      if (!item.ok)
        return item
      out[key] = item.value
    }
    return { ok: true, value: out }
  }
  return { ok: false }
}
