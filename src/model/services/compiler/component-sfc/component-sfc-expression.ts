import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'

import type {
  RComponentSFC_IR_Read,
  RComponentSFC_IR_Value,
  RComponentSFC_IR_VocabRead,
} from '@/domain/types/component/sfc/ir.types'
import type { EndgeRuntimeContextSnapshot } from '@/domain/types/runtime/context-persistence.types'
import type { EndgeConfigurationSchemaEntry } from '@/domain/types/source/configuration-source.types'
import { parseExpression } from '@babel/parser'

const SFC_PLATFORM_LOCALS = new Set(['$table', '$row', '$column', '$cell'])

/** Контекст анализа выражения SFC template/script. */
export interface ComponentSFCExpressionContext {
  /** Имена props, доступные выражению. */
  props?: Iterable<string>

  /** Имена локальных bindings, доступные выражению. */
  locals?: Iterable<string>

  /** Путь source для diagnostics. */
  sourcePath?: string
}

/** Результат компиляции expression в renderer-neutral IR value. */
export interface ComponentSFCExpressionCompileResult {
  /** Нормализованное значение IR. */
  value: RComponentSFC_IR_Value

  /** Diagnostics, найденные при анализе expression. */
  diagnostics: RComponentDiagnostic[]
}

export type ComponentSFCExpressionCompletionScope = 'table-row-menu' | 'table-column-menu'

export interface ComponentSFCExpressionCompletionRequest {
  source: string
  cursor: number
  scope: ComponentSFCExpressionCompletionScope
  context?: Readonly<EndgeRuntimeContextSnapshot> | Record<string, unknown>
  configurations?: Iterable<EndgeConfigurationSchemaEntry>
}

export interface ComponentSFCExpressionCompletion {
  label: string
  insertText: string
  kind: 'variable' | 'property' | 'configuration'
  detail: string
  documentation?: string
  replace: {
    start: number
    end: number
  }
}

interface ExpressionCompletionCandidate {
  label: string
  kind: ComponentSFCExpressionCompletion['kind']
  detail: string
  documentation?: string
}

const TABLE_ROW_MENU_EXPRESSION_ROOTS: readonly ExpressionCompletionCandidate[] = [
  { label: '$row', kind: 'variable', detail: 'Строка таблицы: id, index и data' },
  { label: '$cell', kind: 'variable', detail: 'Текущая ячейка: value' },
  { label: '$column', kind: 'variable', detail: 'Колонка: key, index, title и metadata' },
  { label: '$table', kind: 'variable', detail: 'Таблица и её runtime state' },
  { label: '$context', kind: 'variable', detail: 'Read-only Endge runtime context' },
  { label: 'props', kind: 'variable', detail: 'Входные параметры Component SFC' },
  { label: 'row', kind: 'variable', detail: 'Исходные данные строки' },
  { label: 'rowId', kind: 'variable', detail: 'Identity текущей строки' },
  { label: 'rowIndex', kind: 'variable', detail: 'Индекс текущей строки' },
  { label: 'columnKey', kind: 'variable', detail: 'Key текущей колонки' },
  { label: 'columnMeta', kind: 'variable', detail: 'Metadata текущей колонки' },
  { label: 'value', kind: 'variable', detail: 'Значение текущей ячейки' },
]

const TABLE_COLUMN_MENU_EXPRESSION_ROOTS: readonly ExpressionCompletionCandidate[] = [
  { label: '$table', kind: 'variable', detail: 'Таблица и её runtime state' },
  { label: '$context', kind: 'variable', detail: 'Read-only Endge runtime context' },
  { label: 'props', kind: 'variable', detail: 'Входные параметры Component SFC' },
]

const STATIC_MEMBER_CANDIDATES: Readonly<Record<string, readonly ExpressionCompletionCandidate[]>> = {
  '$row': [
    { label: 'id', kind: 'property', detail: 'Identity строки' },
    { label: 'index', kind: 'property', detail: 'Индекс строки' },
    { label: 'data', kind: 'property', detail: 'Исходные данные строки' },
  ],
  '$cell': [
    { label: 'value', kind: 'property', detail: 'Значение ячейки' },
  ],
  '$column': [
    { label: 'key', kind: 'property', detail: 'Key колонки' },
    { label: 'index', kind: 'property', detail: 'Индекс колонки' },
    { label: 'title', kind: 'property', detail: 'Заголовок колонки' },
    { label: 'metadata', kind: 'property', detail: 'Metadata колонки' },
  ],
  '$table': [
    { label: 'id', kind: 'property', detail: 'Identity таблицы' },
    { label: 'runtimeId', kind: 'property', detail: 'Runtime identity таблицы' },
    { label: 'state', kind: 'property', detail: 'Runtime state таблицы' },
  ],
  '$table.state': [
    { label: 'selectedRowIds', kind: 'property', detail: 'Identity выбранных строк' },
  ],
}

/**
 * Возвращает renderer-neutral подсказки для SFC expression в точной lexical
 * области. UI отвечает только за отображение и применение replacement range.
 */
export function resolveComponentSFCExpressionCompletions(
  request: ComponentSFCExpressionCompletionRequest,
): ComponentSFCExpressionCompletion[] {
  const source = String(request.source ?? '')
  const cursor = Math.max(0, Math.min(source.length, Number(request.cursor) || 0))
  if (isInsideQuotedExpression(source, cursor)) {
    return []
  }

  const token = source.slice(0, cursor).match(/[$A-Z_][\w$]*(?:\.[\w$]*)*$/i)?.[0] ?? ''
  if (!token) {
    return []
  }
  const replacementEnd = cursor + (source.slice(cursor).match(/^[\w$]*/)?.[0].length ?? 0)

  const memberSeparator = token.lastIndexOf('.')
  if (memberSeparator < 0) {
    if (!token.startsWith('$')) {
      return []
    }
    return filterExpressionCompletionCandidates(
      request.scope === 'table-row-menu'
        ? TABLE_ROW_MENU_EXPRESSION_ROOTS
        : TABLE_COLUMN_MENU_EXPRESSION_ROOTS,
      token,
      cursor - token.length,
      replacementEnd,
    )
  }

  const parentPath = token.slice(0, memberSeparator)
  const prefix = token.slice(memberSeparator + 1)
  if (!expressionRootIsAvailable(parentPath, request.scope)) {
    return []
  }

  const candidates = resolveMemberCompletionCandidates(parentPath, request)
  return filterExpressionCompletionCandidates(candidates, prefix, cursor - prefix.length, replacementEnd)
}

function expressionRootIsAvailable(path: string, scope: ComponentSFCExpressionCompletionScope): boolean {
  const root = path.split('.')[0] ?? ''
  const candidates = scope === 'table-row-menu'
    ? TABLE_ROW_MENU_EXPRESSION_ROOTS
    : TABLE_COLUMN_MENU_EXPRESSION_ROOTS
  return candidates.some(candidate => candidate.label === root)
}

function resolveMemberCompletionCandidates(
  parentPath: string,
  request: ComponentSFCExpressionCompletionRequest,
): ExpressionCompletionCandidate[] {
  const staticCandidates = STATIC_MEMBER_CANDIDATES[parentPath]
  if (staticCandidates) {
    if (parentPath === '$table.state' && request.scope !== 'table-row-menu') {
      return []
    }
    return [...staticCandidates]
  }

  if (!parentPath.startsWith('$context')) {
    return []
  }
  const runtimeCandidates = objectMemberCompletionCandidates(readContextPath(request.context, parentPath))
  if (!parentPath.startsWith('$context.config')) {
    return runtimeCandidates
  }

  const configurations = [...(request.configurations ?? [])].filter(entry => entry.document)
  if (parentPath === '$context.config') {
    const byIdentity = new Map(configurations.map(entry => [entry.identity, entry]))
    return runtimeCandidates.map((candidate) => {
      const configuration = byIdentity.get(candidate.label)
      return configuration
        ? {
            ...candidate,
            kind: 'configuration',
            detail: configuration.displayName,
            ...(configuration.description ? { documentation: configuration.description } : {}),
          }
        : { ...candidate, detail: 'System configuration' }
    })
  }

  const identity = parentPath.slice('$context.config.'.length).split('.')[0] ?? ''
  const configuration = configurations.find(entry => entry.identity === identity)
  if (parentPath !== `$context.config.${identity}` || !configuration?.document) {
    return runtimeCandidates
  }
  const byKey = new Map(configuration.document.values.map(field => [field.key, field]))
  return runtimeCandidates.map((candidate) => {
    const field = byKey.get(candidate.label)
    if (!field) {
      return candidate
    }
    const type = field.type.kind === 'reference' ? field.type.identity : field.type.kind
    return {
      ...candidate,
      detail: `${field.label} · ${type}`,
      ...(field.description ? { documentation: field.description } : {}),
    }
  })
}

function readContextPath(
  context: ComponentSFCExpressionCompletionRequest['context'],
  path: string,
): unknown {
  if (!context) {
    return undefined
  }
  return path.split('.').slice(1).reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined
    }
    return (current as Record<string, unknown>)[segment]
  }, context)
}

function objectMemberCompletionCandidates(value: unknown): ExpressionCompletionCandidate[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return []
  }
  return Object.keys(value)
    .filter(isExpressionIdentifier)
    .map(label => ({ label, kind: 'property', detail: 'Context property' }))
}

function filterExpressionCompletionCandidates(
  candidates: readonly ExpressionCompletionCandidate[],
  prefix: string,
  start: number,
  end: number,
): ComponentSFCExpressionCompletion[] {
  const normalizedPrefix = prefix.toLocaleLowerCase()
  return candidates
    .filter(candidate => candidate.label.toLocaleLowerCase().startsWith(normalizedPrefix))
    .map(candidate => ({
      ...candidate,
      insertText: candidate.label,
      replace: { start, end },
    }))
}

function isExpressionIdentifier(value: string): boolean {
  return /^[A-Z_$][\w$]*$/i.test(value)
}

function isInsideQuotedExpression(source: string, cursor: number): boolean {
  let quote: '\'' | '"' | '`' | null = null
  for (let index = 0; index < cursor; index += 1) {
    const character = source[index]
    if (character === '\\') {
      index += 1
      continue
    }
    if (quote) {
      if (character === quote) {
        quote = null
      }
      continue
    }
    if (character === '\'' || character === '"' || character === '`') {
      quote = character
    }
  }
  return quote != null
}

/** Возвращает статический fallback из `t(key, fallback)` без i18n/runtime-контекста. */
export function readComponentSFCTranslationFallback(source: string): string | null {
  try {
    const expression = parseExpression(String(source ?? '').trim(), {
      sourceType: 'module',
      plugins: ['typescript'],
    })

    if (
      expression?.type !== 'CallExpression'
      || expression.callee?.type !== 'Identifier'
      || expression.callee.name !== 't'
    ) {
      return null
    }

    const fallback = expression.arguments?.[1]
    if (fallback?.type === 'StringLiteral') {
      return fallback.value
    }
    if (fallback?.type === 'TemplateLiteral' && fallback.expressions?.length === 0) {
      return fallback.quasis?.[0]?.value?.cooked ?? fallback.quasis?.[0]?.value?.raw ?? null
    }
  }
  catch {
    return null
  }

  return null
}

/** Компилирует expression и извлекает reactive reads для runtime-подписок. */
export function compileComponentSFCExpression(
  source: string,
  context: ComponentSFCExpressionContext = {},
): ComponentSFCExpressionCompileResult {
  const diagnostics: RComponentDiagnostic[] = []
  const expression = String(source ?? '').trim()

  if (!expression) {
    return {
      value: {
        kind: 'literal',
        value: '',
      },
      diagnostics,
    }
  }

  try {
    const ast = parseExpression(expression, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as unknown
    const vocabReads = collectVocabReads(ast, expression, diagnostics, context)

    return {
      value: {
        kind: 'expression',
        source: expression,
        reads: collectExpressionReads(ast, context),
        ...(vocabReads.length ? { vocabReads } : {}),
      },
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-expression-parse-error',
      message: `Не удалось разобрать выражение "${expression}": ${error?.message ?? error}`,
      sourcePath: context.sourcePath,
      start: typeof error?.pos === 'number' ? error.pos : undefined,
    })

    return {
      value: {
        kind: 'expression',
        source: expression,
        reads: [],
      },
      diagnostics,
    }
  }
}

/**
 * Извлекает только статические `vocab(alias, mapping?)`, чтобы alias оставался
 * compiler-visible, а runtime не пытался угадывать физическую identity.
 */
function collectVocabReads(
  ast: unknown,
  source: string,
  diagnostics: RComponentDiagnostic[],
  context: ComponentSFCExpressionContext,
): RComponentSFC_IR_VocabRead[] {
  const result: RComponentSFC_IR_VocabRead[] = []

  visitExpressionNode(ast, (node) => {
    if (
      node.type !== 'CallExpression'
      || node.callee?.type !== 'Identifier'
      || node.callee.name !== 'vocab'
    ) {
      return
    }

    const args = Array.isArray(node.arguments) ? node.arguments : []
    const alias = args[0]?.type === 'StringLiteral'
      ? String(args[0].value ?? '').trim()
      : ''
    const mapping = readVocabMapping(args[1])

    if (!alias || args.length > 2 || (args[1] != null && !mapping)) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-vocab-call-shape',
        message: 'vocab() принимает статический alias и optional mapping { valuePath, labelPath } со строковыми значениями.',
        sourcePath: context.sourcePath,
        start: typeof node.start === 'number' ? node.start : undefined,
        end: typeof node.end === 'number' ? node.end : undefined,
      })
      return
    }

    result.push({
      alias,
      valuePath: mapping?.valuePath ?? 'value',
      labelPath: mapping?.labelPath ?? 'label',
      raw: source,
    })
  })

  return result
}

function readVocabMapping(node: any): { valuePath: string, labelPath: string } | null {
  if (!node || node.type !== 'ObjectExpression') {
    return null
  }

  const values = new Map<string, string>()
  for (const property of node.properties ?? []) {
    if (property?.type !== 'ObjectProperty' || property.computed) {
      return null
    }
    const key = property.key?.type === 'Identifier'
      ? property.key.name
      : property.key?.type === 'StringLiteral'
        ? property.key.value
        : null
    if ((key !== 'valuePath' && key !== 'labelPath') || property.value?.type !== 'StringLiteral') {
      return null
    }
    values.set(key, String(property.value.value ?? '').trim())
  }

  const valuePath = values.get('valuePath') ?? ''
  const labelPath = values.get('labelPath') ?? ''
  return valuePath && labelPath ? { valuePath, labelPath } : null
}

function collectExpressionReads(ast: unknown, context: ComponentSFCExpressionContext): RComponentSFC_IR_Read[] {
  const props = new Set(context.props ?? [])
  const locals = new Set(context.locals ?? [])
  const reads = new Map<string, RComponentSFC_IR_Read>()

  visitExpressionNode(ast, (node) => {
    const path = readMemberPath(node)
    if (!path.length) {
      return
    }

    const root = path[0]
    const source = resolveReadSource(root, props, locals)
    if (!source) {
      return
    }

    const raw = path.join('.')
    reads.set(`${source}:${raw}`, {
      source,
      path,
      raw,
    })
  })

  return [...reads.values()]
}

function resolveReadSource(
  root: string,
  props: Set<string>,
  locals: Set<string>,
): RComponentSFC_IR_Read['source'] | null {
  if (root === 'raph' || root === 'Raph') {
    return 'raph'
  }
  if (root === '$context') {
    return 'context'
  }
  if (SFC_PLATFORM_LOCALS.has(root)) {
    return 'local'
  }
  if (props.has(root) || root === 'props') {
    return 'props'
  }
  if (locals.has(root)) {
    return 'local'
  }
  return null
}

function visitExpressionNode(node: unknown, visitor: (node: Record<string, any>) => void): void {
  if (!node || typeof node !== 'object') {
    return
  }

  const record = node as Record<string, any>
  visitor(record)

  for (const value of Object.values(record)) {
    if (!value) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visitExpressionNode(item, visitor)
      }
      continue
    }
    if (typeof value === 'object') {
      visitExpressionNode(value, visitor)
    }
  }
}

function readMemberPath(node: Record<string, any>): string[] {
  if (node.type === 'Identifier') {
    return [node.name].filter(Boolean)
  }

  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression') {
    return []
  }

  const objectPath = readMemberPath(node.object)
  if (!objectPath.length) {
    return []
  }

  if (node.property?.type === 'Identifier' && !node.computed) {
    return [...objectPath, node.property.name]
  }

  if (node.property?.type === 'StringLiteral') {
    return [...objectPath, node.property.value]
  }

  return objectPath
}
