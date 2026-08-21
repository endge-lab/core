import type { VocabSourceDocument, VocabSourcePatch } from '@/domain/types/source/vocab-source.types'
import type { SourcePatchResult } from '@/domain/types/source/source-engine.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileVocabSource } from '@/model/services/source-engine/compilers/vocab-source-compile'

export function parseVocabSource(source: string) {
  const result = compileVocabSource(source)
  const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')
  return { ok, ast: result.ast ?? undefined, document: result.document ?? undefined, diagnostics: result.diagnostics, message: ok ? undefined : 'Vocab source contains parsing errors.' }
}

export function patchVocabSource(source: string, patch: VocabSourcePatch): SourcePatchResult<VocabSourceDocument> {
  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const definition = findDefinition(ast)
    if (!definition || definition.end == null)
      return failed(source, 'Vocab source должен содержать defineVocab({...}).')

    const property = definition.properties.find(item => t.isObjectProperty(item) && !item.computed && propertyName(item.key) === 'mock')
    const expression = patch.mock ? printMock(patch.mock.identity, patch.mock.path) : null
    let nextSource = source
    if (property && t.isObjectProperty(property) && property.start != null && property.end != null) {
      const start = property.start
      let end = property.end
      while (end < source.length && /[ \t]/.test(source[end] ?? '')) end += 1
      if (source[end] === ',') end += 1
      if (expression)
        nextSource = replace(source, property.value.start ?? start, property.value.end ?? end, expression)
      else
        nextSource = replace(source, start, end, '')
    }
    else if (expression) {
      const close = definition.end - 1
      const indent = objectIndent(source, definition)
      nextSource = replace(source, close, close, `  ${indent}mock: ${expression},\n${indent}`)
    }

    const parsed = parseVocabSource(nextSource)
    return { ...parsed, source: nextSource, changed: nextSource !== source }
  }
  catch (error) {
    return failed(source, `Не удалось пропатчить Vocab source: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function findDefinition(ast: t.File): t.ObjectExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement)) continue
    const expression = unwrap(statement.expression)
    if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'defineVocab' })) continue
    const argument = expression.arguments[0]
    return argument && t.isExpression(argument) && t.isObjectExpression(unwrap(argument)) ? unwrap(argument) as t.ObjectExpression : null
  }
  return null
}

function printMock(identity: string, path: string | null): string {
  const base = `mock(${quote(identity)})`
  return path ? `${base}.path(${quote(path)})` : base
}

function objectIndent(source: string, node: t.ObjectExpression): string {
  const before = source.slice(0, node.start ?? 0)
  const line = before.slice(before.lastIndexOf('\n') + 1)
  return line.match(/^\s*/)?.[0] ?? ''
}

function propertyName(node: t.Node): string | null {
  if (t.isIdentifier(node)) return node.name
  if (t.isStringLiteral(node)) return node.value
  return null
}

function unwrap<T extends t.Expression>(node: T): t.Expression {
  let value: t.Expression = node
  while (t.isTSAsExpression(value) || t.isTSTypeAssertion(value) || t.isTSNonNullExpression(value) || t.isParenthesizedExpression(value)) value = value.expression
  return value
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function replace(source: string, start: number, end: number, value: string): string {
  return `${source.slice(0, start)}${value}${source.slice(end)}`
}

function failed(source: string, message: string): SourcePatchResult<VocabSourceDocument> {
  return { ok: false, source, changed: false, message, diagnostics: [] }
}
