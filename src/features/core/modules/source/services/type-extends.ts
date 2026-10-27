import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type {
  TypeSourceDefinition,
  TypeSourceExpression,
  TypeSourceField,
} from '@/features/core/modules/source/domain/types/type-source.types'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

// Authored definition базового Type по identity: undefined — Type не найден или содержит ошибки
// (это диагностирует его собственный artifact и проверка ссылок), null — Type без структуры (примитив).
export type TypeExtendsLookup = (identity: string) => TypeSourceDefinition | null | undefined

export interface TypeExtendsResult {
  definition: TypeSourceDefinition | null
  diagnostics: DiagnosticDraft[]
}

/**
 * Разворачивает `extends` object Type: поля базовой цепочки идут первыми (с `inheritedFrom`), собственные
 * добавляются после; поле с тем же именем заменяет унаследованное на его месте, только если совместимо
 * (тот же тип и array, optional → required допустимо). Циклы и не-object база диагностируются.
 */
export function resolveTypeDefinitionExtends(
  definition: TypeSourceDefinition | null,
  lookup: TypeExtendsLookup,
  identity?: string,
): TypeExtendsResult {
  const diagnostics: DiagnosticDraft[] = []
  const resolved = definition ? flatten(definition, identity ? [identity] : [], lookup, diagnostics, true) : null
  return { definition: resolved, diagnostics }
}

function flatten(
  definition: TypeSourceDefinition,
  chain: readonly string[],
  lookup: TypeExtendsLookup,
  diagnostics: DiagnosticDraft[],
  root: boolean,
): TypeSourceDefinition {
  if (definition.kind !== 'object' || !definition.extends) {
    return definition
  }
  const base = definition.extends.identity
  if (chain.includes(base)) {
    diagnostics.push({
      severity: 'error',
      code: 'type-extends-cycle',
      message: `Цикл наследования Type: ${[...chain.slice(chain.indexOf(base)), base].join(' → ')}.`,
      sourcePath: 'extends',
    })
    return definition
  }
  const baseDefinition = lookup(base)
  if (baseDefinition === undefined) {
    return definition
  }
  const flatBase = baseDefinition ? flatten(baseDefinition, [...chain, base], lookup, diagnostics, false) : null
  if (!flatBase || flatBase.kind !== 'object') {
    diagnostics.push({
      severity: 'error',
      code: 'type-extends-not-object',
      message: `Type "${base}" не является object Type и не может быть базой extends.`,
      sourcePath: 'extends',
    })
    return definition
  }

  const fields: TypeSourceField[] = flatBase.fields.map(field => ({ ...field, inheritedFrom: field.inheritedFrom ?? base }))
  const positions = new Map(fields.map((field, index) => [field.key, index]))
  for (const field of definition.fields) {
    const index = positions.get(field.key)
    if (index == null) {
      fields.push(field)
      continue
    }
    const inherited = fields[index]!
    if (root && !isCompatibleOverride(inherited, field)) {
      diagnostics.push({
        severity: 'error',
        code: 'type-extends-field-incompatible',
        message: `Поле "${field.key}" переопределяет поле Type "${inherited.inheritedFrom}" несовместимым типом: допустимы тот же тип и array, optional → required.`,
        sourcePath: `fields.${field.key}`,
      })
    }
    fields[index] = field
  }
  return { ...definition, fields }
}

function isCompatibleOverride(inherited: TypeSourceField, own: TypeSourceField): boolean {
  return inherited.array === own.array
    && !(own.optional && !inherited.optional)
    && typeKey(inherited.type) === typeKey(own.type)
}

// Структурный ключ типа без метаданных contextSwitch.
function typeKey(expression: TypeSourceExpression): string {
  return JSON.stringify(expression, (key, value) => key === 'contextVariants' || key === 'inheritedFrom' ? undefined : value)
}
