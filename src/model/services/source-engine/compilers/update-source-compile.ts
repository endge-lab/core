import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { UpdateMutationStrategy, UpdateSourceCompileResult } from '@/domain/types/source/update-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { diagnostic, propertyName, unwrapExpression } from '@/model/services/source-engine/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>
const STRATEGIES = new Set<UpdateMutationStrategy>(['set', 'merge', 'replace', 'append', 'remove'])

/** Compiles one Store-owned update recipe into a runtime-ready mutation descriptor. */
export function compileUpdateSource(source: string, sourceVersion = 1): UpdateSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  if (!String(source ?? '').trim()) {
    diagnostics.push(diagnostic('error', 'update-source-empty', 'Update source пуст.'))
    return { ast: null, document: null, artifact: null, diagnostics }
  }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineUpdate(ast)
    const definition = call?.arguments[0]
    if (!call || !definition || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'update-source-definition', 'Update source должен содержать defineUpdate({...}).'))
      return { ast, document: null, artifact: null, diagnostics }
    }

    const values: Record<string, string | null> = {}
    for (const property of definition.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'update-source-property', 'defineUpdate допускает только обычные properties.', 'defineUpdate', property))
        continue
      }
      const name = propertyName(property.key)
      if (!name || !['handles', 'strategy', 'target', 'keyFrom', 'valueFrom'].includes(name)) {
        diagnostics.push(diagnostic('error', 'update-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Update v1.`, name ?? 'defineUpdate', property))
        continue
      }
      const value = unwrapExpression(property.value)
      values[name] = t.isNullLiteral(value) ? null : t.isStringLiteral(value) ? value.value.trim() : ''
      if (!t.isNullLiteral(value) && !t.isStringLiteral(value))
        diagnostics.push(diagnostic('error', 'update-source-property-type', `${name} должен быть string literal${name === 'handles' || name.endsWith('From') ? ' или null' : ''}.`, name, value))
    }

    const strategy = values.strategy as UpdateMutationStrategy
    const target = values.target ?? ''
    if (!STRATEGIES.has(strategy))
      diagnostics.push(diagnostic('error', 'update-strategy-invalid', 'strategy должен быть set, merge, replace, append или remove.', 'strategy', definition))
    if (!target)
      diagnostics.push(diagnostic('error', 'update-target-required', 'target должен содержать Store-relative path.', 'target', definition))
    if (target.startsWith('.') || target.includes('..'))
      diagnostics.push(diagnostic('error', 'update-target-invalid', 'target должен быть безопасным Store-relative path.', 'target', definition))
    if (target.includes('$key') && !values.keyFrom)
      diagnostics.push(diagnostic('error', 'update-key-required', 'target с $key требует keyFrom.', 'keyFrom', definition))

    const document = {
      handles: values.handles || null,
      strategy: STRATEGIES.has(strategy) ? strategy : 'set',
      target,
      keyFrom: values.keyFrom || null,
      valueFrom: values.valueFrom == null ? null : values.valueFrom,
    }
    const hasErrors = diagnostics.some(item => item.severity === 'error')
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : { type: 'update', sourceVersion, ...document },
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'update-source-parse-error', `Не удалось распарсить Update source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, diagnostics }
  }
}

function findDefineUpdate(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineUpdate' }))
      return expression
  }
  return null
}
