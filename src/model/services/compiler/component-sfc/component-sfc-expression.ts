import { parseExpression } from '@babel/parser'

import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_IR_Read,
  RComponentSFC_IR_Value,
  RComponentSFC_IR_VocabRead,
} from '@/domain/types/component/sfc'

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
  if (!node || node.type !== 'ObjectExpression')
    return null

  const values = new Map<string, string>()
  for (const property of node.properties ?? []) {
    if (property?.type !== 'ObjectProperty' || property.computed)
      return null
    const key = property.key?.type === 'Identifier'
      ? property.key.name
      : property.key?.type === 'StringLiteral'
        ? property.key.value
        : null
    if ((key !== 'valuePath' && key !== 'labelPath') || property.value?.type !== 'StringLiteral')
      return null
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
    if (!path.length)
      return

    const root = path[0]
    const source = resolveReadSource(root, props, locals)
    if (!source)
      return

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
  if (root === 'raph' || root === 'Raph')
    return 'raph'
  if (props.has(root) || root === 'props')
    return 'props'
  if (locals.has(root))
    return 'local'
  return null
}

function visitExpressionNode(node: unknown, visitor: (node: Record<string, any>) => void): void {
  if (!node || typeof node !== 'object')
    return

  const record = node as Record<string, any>
  visitor(record)

  for (const value of Object.values(record)) {
    if (!value)
      continue
    if (Array.isArray(value)) {
      for (const item of value)
        visitExpressionNode(item, visitor)
      continue
    }
    if (typeof value === 'object')
      visitExpressionNode(value, visitor)
  }
}

function readMemberPath(node: Record<string, any>): string[] {
  if (node.type === 'Identifier')
    return [node.name].filter(Boolean)

  if (node.type !== 'MemberExpression' && node.type !== 'OptionalMemberExpression')
    return []

  const objectPath = readMemberPath(node.object)
  if (!objectPath.length)
    return []

  if (node.property?.type === 'Identifier' && !node.computed)
    return [...objectPath, node.property.name]

  if (node.property?.type === 'StringLiteral')
    return [...objectPath, node.property.value]

  return objectPath
}
