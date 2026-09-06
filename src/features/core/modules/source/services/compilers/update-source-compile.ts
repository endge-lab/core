import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type {
  UpdateMutationDescriptor,
  UpdateMutationStrategy,
  UpdateSourceCompileResult,
} from '@/features/core/modules/source/domain/types/update-source.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { compileSourceExpression, diagnostic, propertyName, readStringArgument, unwrapExpression } from '@/features/core/modules/source/services/compilers/source-expression-compile'

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
        plane: 'data',
        namespace: null,
        forEach: null,
        ifExists: null,
        valueFrom: legacy.valueFrom ?? null,
        value: null,
        when: null,
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
  let plane: UpdateMutationDescriptor['plane'] = 'data'
  let namespace: string | null = null
  let forEach: string | null = null
  let ifExists: string | null = null
  let valueFrom: string | null = null
  let valueExpression: UpdateMutationDescriptor['value'] = null
  let when: UpdateMutationDescriptor['when'] = null
  let hasValue = false
  let hasValueFrom = false
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
    if (!name || !['strategy', 'target', 'forEach', 'ifExists', 'valueFrom', 'value', 'when'].includes(name)) {
      diagnostics.push(diagnostic('error', 'update-mutation-property-unsupported', `Свойство "${name ?? ''}" не поддерживается mutation.`, sourcePath, property))
      continue
    }
    if (name === 'target') {
      if (t.isStringLiteral(value)) {
        target = value.value.trim()
        plane = 'data'
        namespace = null
      }
      else {
        const metaTarget = readMetaTarget(value, diagnostics, `${sourcePath}.target`)
        if (metaTarget) {
          target = metaTarget.path
          plane = 'meta'
          namespace = metaTarget.namespace
        }
      }
      continue
    }
    if (name === 'value') {
      hasValue = true
      valueExpression = compileUpdateExpression(value, diagnostics, `${sourcePath}.value`)
      continue
    }
    if (name === 'when') {
      when = compileUpdateExpression(value, diagnostics, `${sourcePath}.when`)
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
    else if (name === 'forEach') {
      forEach = value.value.trim() || null
    }
    else if (name === 'ifExists') {
      ifExists = value.value.trim() || null
    }
    else {
      valueFrom = value.value.trim()
      hasValueFrom = true
    }
  }
  if (hasValue && hasValueFrom) {
    diagnostics.push(diagnostic('error', 'update-value-conflict', 'mutation.value и mutation.valueFrom являются альтернативами.', sourcePath, node))
  }
  const mutation = { strategy, target, plane, namespace, forEach, ifExists, valueFrom, value: valueExpression, when, vars }
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
  if (mutation.target.includes('*')) {
    diagnostics.push(diagnostic('error', 'update-target-wildcard', 'Mutation target не может содержать wildcard.', `${sourcePath}.target`))
  }
  if (mutation.ifExists?.startsWith('.') || mutation.ifExists?.includes('..')) {
    diagnostics.push(diagnostic('error', 'update-read-path-invalid', 'ifExists должен быть безопасным Store-relative path.', `${sourcePath}.ifExists`))
  }
  if (mutation.ifExists?.includes('*')) {
    diagnostics.push(diagnostic('error', 'update-read-path-wildcard', 'ifExists не может содержать wildcard.', `${sourcePath}.ifExists`))
  }
  if (mutation.plane === 'meta' && !mutation.namespace?.trim()) {
    diagnostics.push(diagnostic('error', 'update-meta-namespace-required', 'Meta target требует непустой namespace.', `${sourcePath}.target`))
  }
  const storeReads = [mutation.value, mutation.when]
    .flatMap(collectExpressionReads)
    .filter(read => ['update-data', 'update-meta', 'update-has-data', 'update-has-meta'].includes(read.source))
  const referenced = [...`${mutation.target} ${mutation.ifExists ?? ''} ${storeReads.map(read => read.path).join(' ')}`.matchAll(/\$([A-Z_]\w*)/gi)].map(match => match[1]!)
  for (const name of referenced) {
    if (!mutation.vars[name]) {
      diagnostics.push(diagnostic('error', 'update-var-required', `target использует $${name}, но mutation.vars.${name} не задан.`, `${sourcePath}.vars.${name}`))
    }
  }
}

function readMetaTarget(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): { path: string, namespace: string } | null {
  if (!t.isCallExpression(node) || !t.isIdentifier(node.callee, { name: 'meta' })) {
    diagnostics.push(diagnostic('error', 'update-target-type', 'target должен быть string literal или meta(path, namespace).', sourcePath, node))
    return null
  }
  const path = readStringArgument(node, 0)
  const namespace = readStringArgument(node, 1)
  if (node.arguments.length !== 2 || path == null || namespace == null) {
    diagnostics.push(diagnostic('error', 'update-meta-target', 'meta(path, namespace) требует две static строки.', sourcePath, node))
    return null
  }
  return { path: path.trim(), namespace: namespace.trim() }
}

function compileUpdateExpression(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
) {
  walk(node, (current) => {
    if (!t.isCallExpression(current) || !t.isIdentifier(current.callee)) {
      return
    }
    const name = current.callee.name
    const aliases: Record<string, string> = {
      input: '__updateInput',
      item: '__updateItem',
      parent: '__updateParent',
      data: '__updateData',
      meta: '__updateMeta',
      hasData: '__updateHasData',
      hasMeta: '__updateHasMeta',
    }
    const alias = aliases[name]
    if (!alias) {
      return
    }
    const optionalPath = name === 'input' || name === 'item' || name === 'parent'
    const expected = name === 'meta' || name === 'hasMeta' ? 2 : 1
    if (optionalPath && current.arguments.length === 0) {
      current.arguments = [t.stringLiteral('')]
    }
    if (current.arguments.length !== expected || current.arguments.some(argument => !t.isStringLiteral(argument))) {
      diagnostics.push(diagnostic('error', 'update-expression-read-arguments', `${name}(...) принимает ${optionalPath ? 'optional path string' : expected === 2 ? 'path и namespace strings' : 'path string'}.`, sourcePath, current))
    }
    const storeRead = name === 'data' || name === 'meta' || name === 'hasData' || name === 'hasMeta'
    const path = readStringArgument(current, 0)
    if (storeRead && path != null && (path.startsWith('.') || path.includes('..'))) {
      diagnostics.push(diagnostic('error', 'update-read-path-invalid', 'Store read должен быть безопасным Store-relative path.', sourcePath, current))
    }
    if (storeRead && path?.includes('*')) {
      diagnostics.push(diagnostic('error', 'update-read-path-wildcard', 'Store read не может содержать wildcard.', sourcePath, current))
    }
    current.callee = t.identifier(alias)
  })
  return compileSourceExpression(node, diagnostics, sourcePath)
}

function collectExpressionReads(
  expression: UpdateMutationDescriptor['value'],
): Array<Extract<NonNullable<UpdateMutationDescriptor['value']>, { type: 'read' }>> {
  if (!expression) {
    return []
  }
  if (expression.type === 'read') {
    return [expression]
  }
  if (expression.type === 'array') {
    return expression.items.flatMap(collectExpressionReads)
  }
  if (expression.type === 'object') {
    return Object.values(expression.properties).flatMap(collectExpressionReads)
  }
  if (expression.type === 'operation') {
    return expression.arguments.flatMap(collectExpressionReads)
  }
  if (expression.type === 'transform') {
    return [
      ...collectExpressionReads(expression.input),
      ...collectExpressionReads(expression.options),
    ]
  }
  return []
}

function walk(node: t.Node, visit: (node: t.Node) => void): void {
  visit(node)
  const keys = t.VISITOR_KEYS[node.type] ?? []
  for (const key of keys) {
    const child = (node as any)[key]
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item.type === 'string') {
          walk(item, visit)
        }
      }
    }
    else if (child && typeof child.type === 'string') {
      walk(child, visit)
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
