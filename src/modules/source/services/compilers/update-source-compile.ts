import type { ProgramDiagnostic } from '@/modules/program/domain/types/program.types'
import type {
  UpdateMutationDescriptor,
  UpdateMutationStrategy,
  UpdateSourceCompileResult,
} from '@/modules/source/domain/types/update-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { diagnostic, propertyName, unwrapExpression } from '@/modules/source/services/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>
const STRATEGIES = new Set<UpdateMutationStrategy>(['set', 'merge', 'replace', 'append', 'remove'])

/** Компилирует один принадлежащий Store рецепт update в готовый для runtime описатель изменения. */
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

    let handles: string[] = []
    let mutations: UpdateMutationDescriptor[] = []
    const legacy: Record<string, string | null> = {}
    for (const property of definition.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic('error', 'update-source-property', 'defineUpdate допускает только обычные properties.', 'defineUpdate', property))
        continue
      }
      const name = propertyName(property.key)
      if (!name || !['handles', 'mutations', 'strategy', 'target', 'keyFrom', 'valueFrom'].includes(name)) {
        diagnostics.push(diagnostic('error', 'update-source-property-unsupported', `Свойство "${name ?? ''}" не поддерживается Update v1.`, name ?? 'defineUpdate', property))
        continue
      }
      const value = unwrapExpression(property.value)
      if (name === 'handles') {
        if (t.isNullLiteral(value)) {
          handles = []
          continue
        }
        if (t.isStringLiteral(value)) {
          handles = value.value.split(',').map(item => item.trim()).filter(Boolean)
          continue
        }
        if (t.isArrayExpression(value)) {
          handles = value.elements.flatMap((element) => {
            if (element && t.isStringLiteral(element) && element.value.trim()) {
              return [element.value.trim()]
            }
            diagnostics.push(diagnostic('error', 'update-handles-type', 'handles допускает только string literals.', 'handles', element ?? value))
            return []
          })
          continue
        }
        diagnostics.push(diagnostic('error', 'update-handles-type', 'handles должен быть string, string[] или null.', 'handles', value))
        continue
      }
      if (name === 'mutations') {
        if (!t.isArrayExpression(value)) {
          diagnostics.push(diagnostic('error', 'update-mutations-array', 'mutations должен быть массивом object literal.', 'mutations', value))
          continue
        }
        mutations = value.elements.flatMap((element, index) => {
          if (!element || !t.isObjectExpression(element)) {
            diagnostics.push(diagnostic('error', 'update-mutation-shape', 'Элемент mutations должен быть object literal.', `mutations.${index}`, element ?? value))
            return []
          }
          const mutation = readMutation(element, diagnostics, `mutations.${index}`)
          return mutation ? [mutation] : []
        })
        continue
      }
      const parsed = t.isNullLiteral(value) ? null : t.isStringLiteral(value) ? value.value.trim() : ''
      if (!t.isNullLiteral(value) && !t.isStringLiteral(value)) {
        diagnostics.push(diagnostic('error', 'update-source-property-type', `${name} должен быть string literal${name === 'handles' || name.endsWith('From') ? ' или null' : ''}.`, name, value))
      }
      legacy[name] = parsed
    }

    if (!mutations.length && Object.keys(legacy).length) {
      const strategy = legacy.strategy as UpdateMutationStrategy
      const target = legacy.target ?? ''
      mutations = [{
        strategy: STRATEGIES.has(strategy) ? strategy : 'set',
        target,
        forEach: null,
        ifExists: null,
        valueFrom: legacy.valueFrom ?? null,
        vars: legacy.keyFrom ? { key: legacy.keyFrom } : {},
      }]
      validateMutation(mutations[0], diagnostics, 'defineUpdate')
    }
    if (!mutations.length) {
      diagnostics.push(diagnostic('error', 'update-mutations-empty', 'defineUpdate требует хотя бы одну mutation.', 'mutations', definition))
    }

    const document = {
      handles,
      mutations,
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

function readMutation(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): UpdateMutationDescriptor | null {
  let strategy: UpdateMutationStrategy = 'set'
  let target = ''
  let forEach: string | null = null
  let ifExists: string | null = null
  let valueFrom: string | null = null
  let vars: Record<string, string> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'update-mutation-property', 'Mutation допускает только обычные properties.', sourcePath, property))
      continue
    }
    const name = propertyName(property.key)
    const value = unwrapExpression(property.value)
    if (name === 'vars') {
      if (!t.isObjectExpression(value)) {
        diagnostics.push(diagnostic('error', 'update-mutation-vars', 'mutation.vars должен быть object literal.', `${sourcePath}.vars`, value))
        continue
      }
      vars = readStringMap(value, diagnostics, `${sourcePath}.vars`)
      continue
    }
    if (!name || !['strategy', 'target', 'forEach', 'ifExists', 'valueFrom'].includes(name)) {
      diagnostics.push(diagnostic('error', 'update-mutation-property-unsupported', `Свойство "${name ?? ''}" не поддерживается mutation.`, sourcePath, property))
      continue
    }
    if (['forEach', 'ifExists', 'valueFrom'].includes(name) && t.isNullLiteral(value)) {
      if (name === 'forEach') {
        forEach = null
      }
      else if (name === 'ifExists') {
        ifExists = null
      }
      else { valueFrom = null }
      continue
    }
    if (!t.isStringLiteral(value)) {
      diagnostics.push(diagnostic('error', 'update-mutation-property-type', `${name} должен быть string literal${name === 'valueFrom' ? ' или null' : ''}.`, `${sourcePath}.${name}`, value))
      continue
    }
    if (name === 'strategy') {
      strategy = value.value.trim() as UpdateMutationStrategy
    }
    else if (name === 'target') {
      target = value.value.trim()
    }
    else if (name === 'forEach') {
      forEach = value.value.trim() || null
    }
    else if (name === 'ifExists') {
      ifExists = value.value.trim() || null
    }
    else { valueFrom = value.value.trim() }
  }
  const mutation = { strategy, target, forEach, ifExists, valueFrom, vars }
  validateMutation(mutation, diagnostics, sourcePath)
  return mutation
}

function validateMutation(
  mutation: UpdateMutationDescriptor,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): void {
  if (!STRATEGIES.has(mutation.strategy)) {
    diagnostics.push(diagnostic('error', 'update-strategy-invalid', 'strategy должен быть set, merge, replace, append или remove.', `${sourcePath}.strategy`))
  }
  if (!mutation.target) {
    diagnostics.push(diagnostic('error', 'update-target-required', 'target должен содержать Store-relative path.', `${sourcePath}.target`))
  }
  if (mutation.target.startsWith('.') || mutation.target.includes('..')) {
    diagnostics.push(diagnostic('error', 'update-target-invalid', 'target должен быть безопасным Store-relative path.', `${sourcePath}.target`))
  }
  const referenced = [...`${mutation.target} ${mutation.ifExists ?? ''}`.matchAll(/\$([A-Z_]\w*)/gi)].map(match => match[1]!)
  for (const name of referenced) {
    if (!mutation.vars[name]) {
      diagnostics.push(diagnostic('error', 'update-var-required', `target использует $${name}, но mutation.vars.${name} не задан.`, `${sourcePath}.vars.${name}`))
    }
  }
}

function readStringMap(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      continue
    }
    const name = propertyName(property.key)
    const value = unwrapExpression(property.value)
    if (!name || !t.isStringLiteral(value)) {
      diagnostics.push(diagnostic('error', 'update-var-type', 'Значения mutation.vars должны быть payload path string.', sourcePath, property))
      continue
    }
    result[name] = value.value.trim()
  }
  return result
}

function findDefineUpdate(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement)) {
      continue
    }
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineUpdate' })) {
      return expression
    }
  }
  return null
}
