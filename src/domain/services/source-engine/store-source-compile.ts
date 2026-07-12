import type { StoreSourceCompileResult } from '@/domain/types/store-source.types'
import type { ProgramDiagnostic } from '@/domain/types/program.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { diagnostic, propertyName, unwrapExpression } from '@/domain/services/source-engine/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует минимальный Store source v1 без создания runtime. */
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

    let initial: unknown = {}
    let hasInitial = false
    for (const property of definition.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'store-source-property', 'defineStore допускает только обычные properties.', 'defineStore', property))
        continue
      }
      const name = propertyName(property.key)
      if (name !== 'initial') {
        diagnostics.push(diagnostic('error', 'store-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Store v1.`, name ?? 'defineStore', property))
        continue
      }
      hasInitial = true
      const value = readStaticValue(property.value)
      if (!value.ok)
        diagnostics.push(diagnostic('error', 'store-source-initial-static', 'initial должен быть JSON-compatible литералом.', 'initial', property.value))
      else
        initial = value.value
    }
    if (!hasInitial)
      diagnostics.push(diagnostic('error', 'store-source-initial-missing', 'defineStore требует поле initial.', 'initial', definition))

    const document = { initial }
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
