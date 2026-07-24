import { parseExpression } from '@babel/parser'

import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_IR_Read,
  RComponentSFC_IR_Value,
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

    return {
      value: {
        kind: 'expression',
        source: expression,
        reads: collectExpressionReads(ast, context),
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
