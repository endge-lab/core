import type { ProgramDiagnostic } from '@/modules/program/domain/types/program.types'
import type {
  TypeProgramCatalogEntry,
  TypeSourceDefinition,
  TypeSourceExpression,
} from '@/modules/source/domain/types/type-source.types'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

const TYPE_EXPRESSION_BUILTINS = new Set([
  'Array',
  'Boolean',
  'Date',
  'DateTime',
  'ID',
  'Null',
  'Number',
  'Object',
  'Record',
  'String',
  'Time',
  'Any',
  'Promise',
  'Readonly',
  'Partial',
  'Required',
  'Pick',
  'Omit',
  'unknown',
  'never',
  'void',
  'null',
  'undefined',
  'string',
  'number',
  'boolean',
  'object',
  'any',
  'true',
  'false',
])

/** Возвращает все именованные ссылки без раскрытия документа, на который они указывают. */
export function collectTypeDefinitionReferences(definition: TypeSourceDefinition | null): string[] {
  return collectTypeSourceExpressionReferences(definition)
}

/** Возвращает все именованные ссылки из одного рекурсивного выражения типа Source. */
export function collectTypeSourceExpressionReferences(expression: TypeSourceExpression | null | undefined): string[] {
  if (!expression) {
    return []
  }
  const references = new Set<string>()
  visitExpression(expression, identity => references.add(identity))
  return [...references]
}

/** Семантическая диагностика одного Type Source по скомпилированному доменному каталогу. */
export function validateTypeDefinitionReferences(
  definition: TypeSourceDefinition | null,
  knownIdentities: ReadonlySet<string>,
): DiagnosticDraft[] {
  const diagnostics: DiagnosticDraft[] = []
  for (const identity of collectTypeDefinitionReferences(definition)) {
    if (identity === 'Any') {
      diagnostics.push({
        severity: 'warning',
        code: 'type-any-usage',
        message: 'Any отключает строгую проверку для этой части контракта.',
        sourcePath: 'source',
      })
      continue
    }
    if (!knownIdentities.has(identity)) {
      diagnostics.push({
        severity: 'error',
        code: 'type-reference-missing',
        message: `Тип "${identity}" не найден в текущем Type Registry.`,
        sourcePath: 'source',
      })
    }
  }
  return diagnostics
}

/** Диагностика структурного inline-выражения типа, принадлежащего Query или другому Source-документу. */
export function validateTypeSourceExpressionUsage(
  expression: TypeSourceExpression | null | undefined,
  catalog: readonly TypeProgramCatalogEntry[],
  sourcePath: string,
): DiagnosticDraft[] {
  if (!expression) {
    return []
  }
  const known = new Set(catalog.map(item => item.identity))
  const diagnostics: DiagnosticDraft[] = []

  for (const identity of collectTypeSourceExpressionReferences(expression)) {
    if (identity === 'Any' || identity === 'any') {
      diagnostics.push({
        severity: 'warning',
        code: 'type-any-usage',
        message: `Контракт "${sourcePath}" использует Any и не может быть строго проверен.`,
        sourcePath,
      })
      continue
    }
    if (TYPE_EXPRESSION_BUILTINS.has(identity) || known.has(identity)) {
      continue
    }
    diagnostics.push({
      severity: 'error',
      code: 'type-reference-missing',
      message: `Тип "${identity}" из контракта "${sourcePath}" не найден.`,
      sourcePath,
    })
  }
  return diagnostics
}

/** Диагностика выражения типа, принадлежащего Action, Computation, SFC или другому документу. */
export function validateTypeExpressionUsage(
  expression: string | null | undefined,
  catalog: readonly TypeProgramCatalogEntry[],
  sourcePath: string,
): DiagnosticDraft[] {
  const value = String(expression ?? '').trim()
  if (!value) {
    return []
  }
  const known = new Set(catalog.map(item => item.identity))
  const referenced = collectTypeExpressionReferences(value)
  const diagnostics: DiagnosticDraft[] = []

  if (/\b(?:Any|any)\b/.test(value)) {
    diagnostics.push({
      severity: 'warning',
      code: 'type-any-usage',
      message: `Контракт "${sourcePath}" использует Any и не может быть строго проверен.`,
      sourcePath,
    })
  }

  for (const identity of referenced) {
    if (TYPE_EXPRESSION_BUILTINS.has(identity) || known.has(identity)) {
      continue
    }
    diagnostics.push({
      severity: 'error',
      code: 'type-reference-missing',
      message: `Тип "${identity}" из контракта "${sourcePath}" не найден.`,
      sourcePath,
    })
  }
  return diagnostics
}

/** Именованные ссылки реестра для индексации зависимостей Type Program. */
export function collectTypeExpressionReferences(expression: string | null | undefined): Set<string> {
  const value = String(expression ?? '').trim()
  const result = new Set<string>()
  for (const match of value.matchAll(/\b[A-Z_$][\w$]*\b/gi)) {
    const token = match[0]
    const tail = value.slice((match.index ?? 0) + token.length)
    // Имена свойств являются частью структуры TypeScript, а не ссылками Type Registry.
    if (/^\s*(?:\?\s*)?:/.test(tail)) {
      continue
    }
    if (!TYPE_EXPRESSION_BUILTINS.has(token) && /^[A-Z]/.test(token)) {
      result.add(token)
    }
  }
  return result
}

/** Несоответствие контракта намеренно не блокирует работу во время миграции. */
export function validateTypeCompatibility(
  expected: string | null | undefined,
  actual: string | null | undefined,
  sourcePath: string,
): DiagnosticDraft[] {
  const left = normalizeTypeExpression(expected)
  const right = normalizeTypeExpression(actual)
  if (!left || !right || left === right || isAny(left) || isAny(right)) {
    return []
  }
  return [{
    severity: 'warning',
    code: 'type-contract-mismatch',
    message: `Несоответствие типов: ожидался "${expected}", получен "${actual}".`,
    sourcePath,
  }]
}

function visitDefinition(definition: TypeSourceDefinition, visit: (identity: string) => void): void {
  if (definition.kind === 'object') {
    for (const field of definition.fields) {
      visitExpression(field.type, visit)
    }
    return
  }
  if (definition.kind === 'union') {
    for (const variant of definition.variants) {
      visitExpression(variant, visit)
    }
    return
  }
  if (definition.kind === 'array') {
    visitExpression(definition.items, visit)
  }
}

function visitExpression(expression: TypeSourceExpression, visit: (identity: string) => void): void {
  if (expression.kind === 'reference') {
    visit(expression.identity)
    return
  }
  if (expression.kind === 'record') {
    visitExpression(expression.values, visit)
    return
  }
  visitDefinition(expression, visit)
}

function normalizeTypeExpression(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, '')
}

function isAny(value: string): boolean {
  return value === 'Any' || value === 'any' || value.includes('|Any') || value.includes('Any|')
}
