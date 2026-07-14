import type { ProgramMetadataMap, ProgramMetadataValue } from '@/domain/types/program/program-metadata.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

/** Минимальный общий diagnostic-контракт metadata compiler. */
export interface ProgramMetadataCompileDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  sourcePath?: string
  start?: number
  end?: number
}

/** Извлекает optional `metadata` из корневого object DSL. */
export function compileProgramMetadataProperty(
  definition: t.ObjectExpression,
  diagnostics: ProgramMetadataCompileDiagnostic[],
  sourcePath = 'metadata',
): ProgramMetadataMap {
  let metadataNode: t.Expression | null = null

  for (const property of definition.properties) {
    if (!t.isObjectProperty(property) || property.computed || propertyName(property.key) !== 'metadata')
      continue

    if (metadataNode) {
      diagnostics.push(createDiagnostic(
        'program-metadata-duplicate',
        'metadata объявлена повторно.',
        sourcePath,
        property,
      ))
      continue
    }

    if (!t.isExpression(property.value)) {
      diagnostics.push(createDiagnostic(
        'program-metadata-shape',
        'metadata должна быть статическим object literal.',
        sourcePath,
        property,
      ))
      continue
    }

    metadataNode = unwrapExpression(property.value)
  }

  return metadataNode
    ? compileProgramMetadataExpression(metadataNode, diagnostics, sourcePath)
    : {}
}

/** Компилирует source-аргумент `defineMetadata({...})` в metadata map. */
export function compileProgramMetadataSource(
  source: string,
  diagnostics: ProgramMetadataCompileDiagnostic[],
  sourcePath = 'metadata',
): ProgramMetadataMap {
  try {
    const ast = parseTS(`const __metadata = ${source}`, {
      sourceType: 'module',
      plugins: ['typescript'],
    })
    const statement = ast.program.body[0]
    const declaration = t.isVariableDeclaration(statement) ? statement.declarations[0] : null
    const expression = declaration?.init && t.isExpression(declaration.init)
      ? unwrapExpression(declaration.init)
      : null

    if (!expression) {
      diagnostics.push(createDiagnostic(
        'program-metadata-shape',
        'defineMetadata принимает статический object literal.',
        sourcePath,
      ))
      return {}
    }

    return compileProgramMetadataExpression(expression, diagnostics, sourcePath)
  }
  catch (error: any) {
    diagnostics.push({
      severity: 'error',
      code: 'program-metadata-parse-error',
      message: `Не удалось распарсить metadata: ${error?.message ?? error}`,
      sourcePath,
    })
    return {}
  }
}

/** Компилирует статический object literal без выполнения пользовательского JavaScript. */
export function compileProgramMetadataExpression(
  expression: t.Expression,
  diagnostics: ProgramMetadataCompileDiagnostic[],
  sourcePath = 'metadata',
): ProgramMetadataMap {
  const node = unwrapExpression(expression)
  if (!t.isObjectExpression(node)) {
    diagnostics.push(createDiagnostic(
      'program-metadata-shape',
      'metadata должна быть статическим object literal.',
      sourcePath,
      node,
    ))
    return {}
  }

  const result = readObject(node, diagnostics, sourcePath)
  return result.ok ? result.value : {}
}

function readObject(
  node: t.ObjectExpression,
  diagnostics: ProgramMetadataCompileDiagnostic[],
  sourcePath: string,
): { ok: true, value: ProgramMetadataMap } | { ok: false } {
  const entries: Array<[string, ProgramMetadataValue]> = []
  const declared = new Set<string>()
  let valid = true

  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(createDiagnostic(
        'program-metadata-property',
        'metadata поддерживает только обычные статические properties без spread и computed keys.',
        sourcePath,
        property,
      ))
      valid = false
      continue
    }

    const key = propertyName(property.key)
    if (!key) {
      diagnostics.push(createDiagnostic(
        'program-metadata-key',
        'Не удалось определить ключ metadata.',
        sourcePath,
        property.key,
      ))
      valid = false
      continue
    }

    if (declared.has(key)) {
      diagnostics.push(createDiagnostic(
        'program-metadata-key-duplicate',
        `Ключ metadata "${key}" объявлен повторно.`,
        `${sourcePath}.${key}`,
        property,
      ))
      valid = false
      continue
    }
    declared.add(key)

    const item = readValue(unwrapExpression(property.value), diagnostics, `${sourcePath}.${key}`)
    if (!item.ok) {
      valid = false
      continue
    }
    entries.push([key, item.value])
  }

  return valid ? { ok: true, value: Object.fromEntries(entries) } : { ok: false }
}

function readValue(
  node: t.Expression,
  diagnostics: ProgramMetadataCompileDiagnostic[],
  sourcePath: string,
): { ok: true, value: ProgramMetadataValue } | { ok: false } {
  if (t.isStringLiteral(node) || t.isNumericLiteral(node) || t.isBooleanLiteral(node))
    return { ok: true, value: node.value }

  if (t.isNullLiteral(node))
    return { ok: true, value: null }

  if (t.isUnaryExpression(node, { operator: '-' }) && t.isNumericLiteral(node.argument))
    return { ok: true, value: -node.argument.value }

  if (t.isTemplateLiteral(node) && node.expressions.length === 0)
    return { ok: true, value: node.quasis[0]?.value.cooked ?? '' }

  if (t.isObjectExpression(node))
    return readObject(node, diagnostics, sourcePath)

  if (t.isArrayExpression(node)) {
    const value: ProgramMetadataValue[] = []
    let valid = true
    node.elements.forEach((element, index) => {
      if (!element || !t.isExpression(element)) {
        diagnostics.push(createDiagnostic(
          'program-metadata-array-item',
          'Metadata array не поддерживает holes или spread items.',
          `${sourcePath}.${index}`,
          element ?? node,
        ))
        valid = false
        return
      }

      const item = readValue(unwrapExpression(element), diagnostics, `${sourcePath}.${index}`)
      if (item.ok)
        value.push(item.value)
      else
        valid = false
    })
    return valid ? { ok: true, value } : { ok: false }
  }

  diagnostics.push(createDiagnostic(
    'program-metadata-value',
    'Metadata поддерживает только JSON-совместимые статические значения.',
    sourcePath,
    node,
  ))
  return { ok: false }
}

function unwrapExpression(node: t.Expression): t.Expression {
  let current = node
  while (
    t.isTSAsExpression(current)
    || t.isTSTypeAssertion(current)
    || t.isTSNonNullExpression(current)
    || t.isParenthesizedExpression(current)
  ) {
    current = current.expression
  }
  return current
}

function propertyName(node: t.Node): string | null {
  if (t.isIdentifier(node))
    return node.name
  if (t.isStringLiteral(node) || t.isNumericLiteral(node))
    return String(node.value)
  return null
}

function createDiagnostic(
  code: string,
  message: string,
  sourcePath: string,
  node?: t.Node | null,
): ProgramMetadataCompileDiagnostic {
  return {
    severity: 'error',
    code,
    message,
    sourcePath,
    start: typeof node?.start === 'number' ? node.start : undefined,
    end: typeof node?.end === 'number' ? node.end : undefined,
  }
}
