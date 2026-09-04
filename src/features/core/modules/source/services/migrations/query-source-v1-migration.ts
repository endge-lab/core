import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

export type QuerySourceV1MigrationResult
  = | { ok: true, source: string, sourceVersion: 2 }
    | { ok: false, code: string, message: string }

/**
 * Переводит поддерживаемый legacy Query v1 source в canonical Query v2.
 *
 * Старые params и filters не имеют однозначного аналога без изменения
 * поведения запроса, поэтому автоматическая миграция разрешена только для
 * пустых контрактов. Остальные Query должны быть мигрированы явно автором.
 */
export function migrateQuerySourceV1ToV2(source: string): QuerySourceV1MigrationResult {
  let definition: t.ObjectExpression
  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineQueryCall(ast)
    const argument = call?.arguments[0]
    const expression = argument && t.isExpression(argument) ? unwrapExpression(argument) : null
    if (!t.isObjectExpression(expression)) {
      return failure('query_v1_definition_invalid', 'Query v1 source must contain defineQuery({...}).')
    }
    definition = expression
  }
  catch (error: any) {
    return failure('query_v1_parse_failed', `Query v1 source cannot be parsed: ${error?.message ?? error}`)
  }

  const params = readObjectProperty(definition, 'params')
  if (params && params.properties.length > 0) {
    return failure('query_v1_params_migration_required', 'Query v1 params require an explicit props/body migration.')
  }

  const filters = readObjectProperty(definition, 'filters')
  const filterItems = filters ? readArrayProperty(filters, 'items') : null
  if (filterItems && filterItems.elements.some(Boolean)) {
    return failure('query_v1_filters_migration_required', 'Query v1 filters require an explicit request body migration.')
  }

  const request = readExpressionProperty(definition, 'request')
  if (!request) {
    return failure('query_v1_request_missing', 'Query v1 request is required.')
  }
  if (t.isObjectExpression(request)) {
    const auth = readObjectProperty(request, 'auth')
    const authMode = auth ? readStringProperty(auth, 'mode') : null
    if (authMode && authMode !== 'none' && authMode !== 'inherit' && authMode !== 'profile') {
      return failure(
        'query_v1_auth_migration_required',
        'Legacy Query auth must be replaced with none, inherit or an explicit AuthProfile before migration.',
      )
    }
  }

  const response = readObjectProperty(definition, 'response')
  const subField = response ? readStringProperty(response, 'subField') ?? 'items' : 'items'
  const returnExpression = response ? readExpressionProperty(response, 'return') : null
  const responseSource = subField ? `response(${quote(subField)})` : 'response()'
  const contractSource = returnExpression && !t.isNullLiteral(returnExpression)
    ? `\n      .contract(${sliceSource(source, returnExpression)})`
    : ''

  const kind = readExpressionProperty(definition, 'kind')
  const mock = readExpressionProperty(definition, 'mock')
  const migrated = `defineQuery({
  kind: ${kind ? sliceSource(source, kind) : '\'rest\''},

  props: defineProps({}),

  request: ${sliceSource(source, request)},

  outputs: {
    raw: output()
      .from(${responseSource})${contractSource},
  },

  mock: ${mock ? sliceSource(source, mock) : '{ enabled: false, data: null }'},
})
`

  return { ok: true, source: migrated, sourceVersion: 2 }
}

function findDefineQueryCall(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement)) {
      continue
    }
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineQuery' })) {
      return expression
    }
  }
  return null
}

function readExpressionProperty(node: t.ObjectExpression, key: string): t.Expression | null {
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || propertyName(property.key) !== key || !t.isExpression(property.value)) {
      continue
    }
    return unwrapExpression(property.value)
  }
  return null
}

function readObjectProperty(node: t.ObjectExpression, key: string): t.ObjectExpression | null {
  const value = readExpressionProperty(node, key)
  return value && t.isObjectExpression(value) ? value : null
}

function readArrayProperty(node: t.ObjectExpression, key: string): t.ArrayExpression | null {
  const value = readExpressionProperty(node, key)
  return value && t.isArrayExpression(value) ? value : null
}

function readStringProperty(node: t.ObjectExpression, key: string): string | null {
  const value = readExpressionProperty(node, key)
  return value && t.isStringLiteral(value) ? value.value : null
}

function propertyName(node: t.ObjectProperty['key']): string | null {
  if (t.isIdentifier(node)) {
    return node.name
  }
  if (t.isStringLiteral(node) || t.isNumericLiteral(node)) {
    return String(node.value)
  }
  return null
}

function unwrapExpression<T extends t.Expression>(node: T): t.Expression {
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTypeCastExpression(node) || t.isParenthesizedExpression(node)) {
    return unwrapExpression(node.expression)
  }
  return node
}

function sliceSource(source: string, node: t.Node): string {
  if (typeof node.start !== 'number' || typeof node.end !== 'number') {
    return ''
  }
  return source.slice(node.start, node.end)
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`
}

function failure(code: string, message: string): QuerySourceV1MigrationResult {
  return { ok: false, code, message }
}
