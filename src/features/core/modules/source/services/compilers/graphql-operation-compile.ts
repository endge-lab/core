import type { DocumentNode } from 'graphql'
import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { GraphQLDocumentFragments, GraphQLFragmentVariant } from '@/features/core/modules/source/domain/types/graphql-fragments.types'
import type { SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'

import * as t from '@babel/types'
import { Kind, parse as parseGraphQL } from 'graphql'

import {
  compileSourceCallback,
  diagnostic,
  propertyName,
  pushContextUnbound,
  readContextSwitchNode,
  unwrapExpression,
} from '@/features/core/modules/source/services/compilers/source-expression-compile'
import { collectGraphQLDocumentUsage, composeGraphQLDocument, readGraphQLFragmentDefinitions } from '@/features/core/modules/source/services/graphql-fragments'
import { getSourceContext, selectContextCase } from '@/features/core/modules/source/services/source-context'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

export type GraphQLOperationKind = 'query' | 'mutation' | 'subscription'

// Общие правила GraphQL operation для Query (request) и Stream (transport graphqlSse).
export interface GraphQLOperationSourceOptions {
  // Префикс кодов диагностик: 'query-source' → 'query-source-graphql-document-shape'.
  codePrefix: string
  // Префикс sourcePath: 'request' → 'request.document'.
  sourcePathPrefix: string
  // Допустимые виды operation в документе.
  operations: readonly GraphQLOperationKind[]
  // Диагностика для operation вне operations.
  unsupportedOperation: { code: string, message: string }
}

// Читает статический gql`...` или gql('...') без interpolation.
export function readGraphQLDocumentSource(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  options: GraphQLOperationSourceOptions,
): string {
  const sourcePath = `${options.sourcePathPrefix}.document`
  const expression = unwrapExpression(node)
  if (
    t.isTaggedTemplateExpression(expression)
    && t.isIdentifier(expression.tag, { name: 'gql' })
    && expression.quasi.expressions.length === 0
  ) {
    return expression.quasi.quasis[0]?.value.cooked ?? ''
  }

  if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'gql' })) {
    const value = expression.arguments[0]
    if (value && t.isExpression(value)) {
      const parsed = readStaticStringSource(value, diagnostics, sourcePath, options.codePrefix)
      if (parsed !== undefined) {
        return parsed
      }
    }
  }

  diagnostics.push(diagnostic(
    'error',
    `${options.codePrefix}-graphql-document-shape`,
    `${sourcePath} должен быть статическим gql\`...\` без JavaScript interpolation.`,
    sourcePath,
    expression,
  ))
  return ''
}

// Компилирует variables(callback) в SourceExpressionIR; props читаются через prop('key').
export function readGraphQLVariablesSource(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  options: GraphQLOperationSourceOptions,
): SourceExpressionIR | null {
  const sourcePath = `${options.sourcePathPrefix}.variables`
  const expression = unwrapExpression(node)
  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'variables' })) {
    diagnostics.push(diagnostic(
      'error',
      `${options.codePrefix}-graphql-variables-shape`,
      `${sourcePath} должен быть variables(callback).`,
      sourcePath,
      expression,
    ))
    return null
  }
  return compileSourceCallback(expression.arguments[0], diagnostics, sourcePath)
}

/**
 * Проверяет синтаксис документа, вид operations и operationName.
 * Возвращает итоговое имя operation: заданное или единственное в документе.
 */
export function validateGraphQLOperationSource(
  document: string,
  requestedOperationName: string | undefined,
  diagnostics: DiagnosticDraft[],
  options: GraphQLOperationSourceOptions,
  node?: t.Node,
): string | undefined {
  if (!document.trim()) {
    return requestedOperationName
  }
  const documentPath = `${options.sourcePathPrefix}.document`
  const operationNamePath = `${options.sourcePathPrefix}.operationName`

  try {
    const parsed = parseGraphQL(document)
    const operations = parsed.definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION)
    if (operations.length === 0) {
      diagnostics.push(diagnostic(
        'error',
        `${options.codePrefix}-graphql-operation-missing`,
        `GraphQL document должен содержать ${options.operations.join(' или ')} operation.`,
        documentPath,
        node,
      ))
      return requestedOperationName
    }
    if (operations.some(operation => !options.operations.includes(operation.operation as GraphQLOperationKind))) {
      diagnostics.push(diagnostic(
        'error',
        options.unsupportedOperation.code,
        options.unsupportedOperation.message,
        documentPath,
        node,
      ))
    }

    if (requestedOperationName) {
      if (!operations.some(operation => operation.name?.value === requestedOperationName)) {
        diagnostics.push(diagnostic(
          'error',
          `${options.codePrefix}-graphql-operation-unknown`,
          `Operation "${requestedOperationName}" не найдена в GraphQL document.`,
          operationNamePath,
          node,
        ))
      }
      return requestedOperationName
    }

    if (operations.length > 1) {
      diagnostics.push(diagnostic(
        'error',
        `${options.codePrefix}-graphql-operation-name-required`,
        `Для GraphQL document с несколькими operations укажите ${operationNamePath}.`,
        operationNamePath,
        node,
      ))
      return undefined
    }
    return operations[0]?.name?.value
  }
  catch (error: any) {
    diagnostics.push(diagnostic(
      'error',
      `${options.codePrefix}-graphql-document-invalid`,
      `Некорректный GraphQL document: ${error?.message ?? error}`,
      documentPath,
      node,
    ))
    return requestedOperationName
  }
}

// Строковый литерал или template literal без interpolation.
export function readStaticStringSource(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  codePrefix: string,
): string | undefined {
  const expression = unwrapExpression(node)
  if (t.isStringLiteral(expression)) {
    return expression.value
  }
  if (t.isTemplateLiteral(expression) && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? ''
  }
  diagnostics.push(diagnostic(
    'error',
    `${codePrefix}-static-string-required`,
    `${sourcePath} должен быть статической строкой.`,
    sourcePath,
    expression,
  ))
  return undefined
}

/**
 * Сверяет variables(...) с объявлениями переменных выбранной operation без схемы.
 * Лишние ключи — warning, отсутствующие обязательные (`!` без default) — error.
 * Проверка выполняется, только если variables(...) отсутствует или возвращает object literal:
 * для вычисляемого объекта набор ключей статически неизвестен.
 */
export function validateGraphQLVariablesSource(
  document: string,
  operationName: string | undefined,
  variablesNode: t.Node | undefined,
  variables: SourceExpressionIR | null,
  diagnostics: DiagnosticDraft[],
  options: GraphQLOperationSourceOptions,
  documentNode?: t.Node,
): void {
  if (!document.trim()) {
    return
  }
  let provided: ReadonlySet<string>
  if (!variablesNode) {
    provided = new Set()
  }
  else if (variables?.type === 'object') {
    provided = new Set(Object.keys(variables.properties))
  }
  else if (variables?.type === 'literal' && variables.value != null && typeof variables.value === 'object' && !Array.isArray(variables.value)) {
    provided = new Set(Object.keys(variables.value))
  }
  else {
    return
  }

  let operations
  try {
    operations = parseGraphQL(document).definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION)
  }
  catch {
    return
  }
  const operation = operationName
    ? operations.find(item => item.name?.value === operationName)
    : operations.length === 1 ? operations[0] : undefined
  if (!operation) {
    return
  }

  const variablesPath = `${options.sourcePathPrefix}.variables`
  const declared = new Map((operation.variableDefinitions ?? []).map(definition => [definition.variable.name.value, definition]))
  const operationLabel = operation.name?.value ? `operation "${operation.name.value}"` : 'operation'
  for (const key of provided) {
    if (!declared.has(key)) {
      diagnostics.push(diagnostic(
        'warning',
        `${options.codePrefix}-graphql-variable-unknown`,
        `Переменная "${key}" передаётся в ${variablesPath}, но не объявлена в ${operationLabel}; сервер её проигнорирует или отклонит запрос.`,
        variablesPath,
        variablesNode,
      ))
    }
  }
  for (const [key, definition] of declared) {
    if (definition.type.kind === Kind.NON_NULL_TYPE && !definition.defaultValue && !provided.has(key)) {
      diagnostics.push(diagnostic(
        'error',
        `${options.codePrefix}-graphql-variable-missing`,
        `Обязательная переменная $${key} из ${operationLabel} не передана в ${variablesPath}.`,
        variablesPath,
        variablesNode ?? documentNode,
      ))
    }
  }
}

// Разобранное поле fragments до проверки по document operation.
export interface GraphQLFragmentsSourceDraft {
  node: t.Node
  entries: Map<string, { variants: GraphQLFragmentVariant[], selected: number, node: t.Node }>
}

/**
 * Читает `fragments: { Имя: gql\`fragment Имя on Тип {...}\` | contextSwitch({...}) }`.
 * Все ветки contextSwitch проверяются; выбирается ветка по фасетам сборки (вне сборки — default).
 */
export function readGraphQLFragmentsSource(
  node: t.Expression,
  diagnostics: DiagnosticDraft[],
  options: GraphQLOperationSourceOptions,
): GraphQLFragmentsSourceDraft {
  const fragmentsPath = `${options.sourcePathPrefix}.fragments`
  const expression = unwrapExpression(node)
  const draft: GraphQLFragmentsSourceDraft = { node: expression, entries: new Map() }
  if (!t.isObjectExpression(expression)) {
    diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragments-shape`, `${fragmentsPath} должен быть object literal { Имя: gql\`fragment Имя on Тип {...}\` }.`, fragmentsPath, expression))
    return draft
  }
  const context = getSourceContext()
  for (const property of expression.properties) {
    const name = t.isObjectProperty(property) && !property.computed ? propertyName(property.key) : null
    if (!name || !t.isObjectProperty(property) || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragments-shape`, `${fragmentsPath} допускает только обычные properties с именем фрагмента.`, fragmentsPath, property))
      continue
    }
    const fragmentPath = `${fragmentsPath}.${name}`
    if (draft.entries.has(name)) {
      diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-duplicate`, `Фрагмент "${name}" объявлен повторно.`, fragmentPath, property))
      continue
    }
    const readVariant = (value: t.Expression, items: DiagnosticDraft[], path: string): string | null =>
      readGraphQLFragmentText(value, name, items, path, options)
    const value = unwrapExpression(property.value)
    if (t.isCallExpression(value) && t.isIdentifier(value.callee, { name: 'contextSwitch' })) {
      const parsed = readContextSwitchNode(value, diagnostics, `${fragmentPath}.contextSwitch`, readVariant)
      if (!parsed || parsed.defaultValue == null || parsed.branches.some(branch => branch.value == null)) {
        continue
      }
      const variants: GraphQLFragmentVariant[] = [
        { when: null, document: parsed.defaultValue },
        ...parsed.branches.map(branch => ({ when: branch.when, document: branch.value! })),
      ]
      let selected = 0
      if (!context) {
        pushContextUnbound('contextSwitch', diagnostics, fragmentPath, value)
      }
      else {
        const index = selectContextCase(parsed.branches, context.facets)
        selected = index == null ? 0 : index + 1
      }
      draft.entries.set(name, { variants, selected, node: property })
      continue
    }
    const text = readVariant(value, diagnostics, fragmentPath)
    if (text != null) {
      draft.entries.set(name, { variants: [{ when: null, document: text }], selected: 0, node: property })
    }
  }
  return draft
}

// Текст одного варианта: статический gql с ровно одним определением fragment и именем, равным ключу.
function readGraphQLFragmentText(
  node: t.Expression,
  name: string,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
  options: GraphQLOperationSourceOptions,
): string | null {
  const expression = unwrapExpression(node)
  let text: string | undefined
  if (t.isTaggedTemplateExpression(expression) && t.isIdentifier(expression.tag, { name: 'gql' }) && expression.quasi.expressions.length === 0) {
    text = expression.quasi.quasis[0]?.value.cooked ?? ''
  }
  else if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'gql' }) && expression.arguments.length === 1 && t.isExpression(expression.arguments[0])) {
    const argument = unwrapExpression(expression.arguments[0])
    if (t.isStringLiteral(argument)) {
      text = argument.value
    }
    else if (t.isTemplateLiteral(argument) && argument.expressions.length === 0) {
      text = argument.quasis[0]?.value.cooked ?? ''
    }
  }
  if (text === undefined) {
    diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-shape`, `Фрагмент "${name}" должен быть статическим gql\`fragment ${name} on Тип {...}\` или contextSwitch({...}) таких значений.`, sourcePath, expression))
    return null
  }
  let parsed: DocumentNode
  try {
    parsed = parseGraphQL(text)
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-invalid`, `Некорректный GraphQL фрагмент "${name}": ${error?.message ?? error}`, sourcePath, expression))
    return null
  }
  const definition = parsed.definitions[0]
  if (parsed.definitions.length !== 1 || definition?.kind !== Kind.FRAGMENT_DEFINITION) {
    diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-shape`, `Фрагмент "${name}" должен содержать ровно одно определение fragment.`, sourcePath, expression))
    return null
  }
  if (definition.name.value !== name) {
    diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-name`, `Ключ "${name}" не совпадает с именем фрагмента "${definition.name.value}".`, sourcePath, expression))
    return null
  }
  return text
}

/**
 * Проверяет spread-ы и фрагменты относительно document operation и подставляет выбранные варианты.
 * Без поля fragments проверяет только, что все spread document определены в нём самом.
 */
export function applyGraphQLFragmentsSource(
  document: string,
  operationName: string | undefined,
  draft: GraphQLFragmentsSourceDraft | null,
  diagnostics: DiagnosticDraft[],
  options: GraphQLOperationSourceOptions,
  documentNode?: t.Node,
): { document: string, fragments?: GraphQLDocumentFragments } {
  if (!document.trim()) {
    return { document }
  }
  let parsed: DocumentNode
  try {
    parsed = parseGraphQL(document)
  }
  catch {
    return { document }
  }
  const documentPath = `${options.sourcePathPrefix}.document`
  const fragmentsPath = `${options.sourcePathPrefix}.fragments`
  const entries = draft?.entries ?? new Map()
  const inline = readGraphQLFragmentDefinitions(parsed)
  for (const [name, entry] of entries) {
    if (inline.has(name)) {
      diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-duplicate`, `Фрагмент "${name}" уже определён в ${documentPath}; уберите одно из определений.`, `${fragmentsPath}.${name}`, entry.node))
    }
  }

  const operations = parsed.definitions.filter(definition => definition.kind === Kind.OPERATION_DEFINITION)
  const operation = operationName ? operations.find(item => item.name?.value === operationName) : operations.length === 1 ? operations[0] : undefined
  const declared = new Set((operation ? [operation] : operations)
    .flatMap(item => item.variableDefinitions ?? [])
    .map(definition => definition.variable.name.value))

  const usageByFragment = new Map<string, Set<string>>()
  const documentUsage = collectGraphQLDocumentUsage(parsed)
  const reportUndefined = (spread: string, path: string, node: t.Node | undefined) => {
    if (!inline.has(spread) && !entries.has(spread)) {
      diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-undefined`, `Фрагмент "...${spread}" не определён ни в ${documentPath}, ни в ${fragmentsPath}.`, path, node))
    }
  }
  for (const spread of documentUsage.spreads) {
    reportUndefined(spread, documentPath, documentNode)
  }
  for (const [name, entry] of entries) {
    const spreads = new Set<string>()
    for (const variant of entry.variants as GraphQLFragmentVariant[]) {
      const usage = collectGraphQLDocumentUsage(parseGraphQL(variant.document))
      for (const spread of usage.spreads) {
        spreads.add(spread)
      }
      for (const variable of usage.variables) {
        if (!declared.has(variable)) {
          const label = variant.when ? `ветка ${JSON.stringify(variant.when)}` : 'default'
          diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-variable-undeclared`, `Фрагмент "${name}" (${label}) использует $${variable}, но operation её не объявляет.`, `${fragmentsPath}.${name}`, entry.node))
        }
      }
    }
    for (const spread of spreads) {
      reportUndefined(spread, `${fragmentsPath}.${name}`, entry.node)
    }
    usageByFragment.set(name, spreads)
  }

  // Циклы spread (A → B → A) по объединению всех вариантов: GraphQL запрещает их (NoFragmentCycles).
  const inlineUsage = new Map<string, Set<string>>()
  for (const definition of parsed.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      inlineUsage.set(definition.name.value, collectGraphQLDocumentUsage({ kind: Kind.DOCUMENT, definitions: [definition] }).spreads)
    }
  }
  for (const cycle of findFragmentCycles(name => usageByFragment.get(name) ?? inlineUsage.get(name), [...entries.keys()])) {
    const first = cycle.find(name => entries.has(name)) ?? cycle[0]!
    diagnostics.push(diagnostic('error', `${options.codePrefix}-graphql-fragment-cycle`, `Фрагменты образуют цикл ${[...cycle, cycle[0]].join(' → ')}; GraphQL запрещает циклические spread.`, `${fragmentsPath}.${first}`, entries.get(first)?.node))
  }

  // Фрагмент, недостижимый из operation ни в одном варианте, сервер отклонит (NoUnusedFragments).
  const reachable = new Set<string>()
  const queue = [...documentUsage.spreads]
  for (const definition of parsed.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      queue.push(...collectGraphQLDocumentUsage({ kind: Kind.DOCUMENT, definitions: [definition] }).spreads)
    }
  }
  while (queue.length) {
    const name = queue.shift()!
    if (reachable.has(name)) {
      continue
    }
    reachable.add(name)
    queue.push(...(usageByFragment.get(name) ?? []))
  }
  for (const [name, entry] of entries) {
    if (!reachable.has(name)) {
      diagnostics.push(diagnostic('warning', `${options.codePrefix}-graphql-fragment-unused`, `Фрагмент "${name}" не используется в operation; он не будет добавлен в document.`, `${fragmentsPath}.${name}`, entry.node))
    }
  }

  if (!entries.size) {
    return { document }
  }
  const fragments: GraphQLDocumentFragments['fragments'] = {}
  for (const [name, entry] of entries) {
    fragments[name] = { variants: entry.variants, selected: entry.selected }
  }
  return {
    document: composeGraphQLDocument(document, name => inline.has(name) ? undefined : fragments[name]?.variants[fragments[name]!.selected]?.document),
    fragments: { operation: document, fragments },
  }
}

// Находит простые циклы в графе spread фрагментов; каждый цикл возвращается один раз.
function findFragmentCycles(spreadsOf: (name: string) => Iterable<string> | undefined, roots: readonly string[]): string[][] {
  const cycles: string[][] = []
  const done = new Set<string>()
  const stack: string[] = []
  const onStack = new Set<string>()
  const visit = (name: string): void => {
    if (done.has(name)) {
      return
    }
    if (onStack.has(name)) {
      cycles.push(stack.slice(stack.indexOf(name)))
      return
    }
    const spreads = spreadsOf(name)
    if (!spreads) {
      return
    }
    stack.push(name)
    onStack.add(name)
    for (const spread of spreads) {
      visit(spread)
    }
    stack.pop()
    onStack.delete(name)
    done.add(name)
  }
  for (const root of roots) {
    visit(root)
  }
  return cycles
}
