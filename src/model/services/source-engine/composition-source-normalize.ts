import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import { propertyName, unwrapExpression } from '@/model/services/source-engine/compilers/source-expression-compile'

interface SourceEdit {
  start: number
  end: number
  replacement: string
}

/** Нормализует ссылки на типы только в полях Composition defineProps. */
export function normalizeCompositionSourceTypeReferences(source: string): string {
  try {
    const ast = parseTS(source, {
      sourceType: 'module',
      plugins: ['typescript'],
      errorRecovery: true,
    })
    const edits: SourceEdit[] = []

    for (const statement of ast.program.body) {
      if (!t.isExpressionStatement(statement)) continue
      const expression = unwrapExpression(statement.expression)
      if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: 'defineComposition' })) continue
      const definition = expression.arguments[0]
      if (!definition || !t.isObjectExpression(definition)) continue
      collectPropsEdits(definition, edits)
    }

    return edits
      .sort((left, right) => right.start - left.start)
      .reduce(
        (result, edit) => `${result.slice(0, edit.start)}${edit.replacement}${result.slice(edit.end)}`,
        source,
      )
  }
  catch {
    return source
  }
}

function collectPropsEdits(definition: t.ObjectExpression, edits: SourceEdit[]): void {
  const propsProperty = definition.properties.find(property => (
    t.isObjectProperty(property)
    && !property.computed
    && propertyName(property.key) === 'props'
  ))
  if (!propsProperty || !t.isObjectProperty(propsProperty) || !t.isExpression(propsProperty.value)) return

  const defineProps = unwrapExpression(propsProperty.value)
  if (!t.isCallExpression(defineProps) || !t.isIdentifier(defineProps.callee, { name: 'defineProps' })) return
  const props = defineProps.arguments[0]
  if (!props || !t.isObjectExpression(props)) return

  for (const property of props.properties) {
    if (!t.isObjectProperty(property) || !t.isExpression(property.value)) continue
    const field = unwrapFieldCall(property.value)
    const typeArgument = field?.arguments[0]
    if (!typeArgument || !t.isStringLiteral(typeArgument) || !t.isValidIdentifier(typeArgument.value)) continue
    if (typeArgument.start == null || typeArgument.end == null) continue
    edits.push({ start: typeArgument.start, end: typeArgument.end, replacement: typeArgument.value })
  }
}

function unwrapFieldCall(raw: t.Expression): t.CallExpression | null {
  let current = unwrapExpression(raw)
  while (t.isCallExpression(current) && t.isMemberExpression(current.callee) && t.isExpression(current.callee.object)) {
    current = unwrapExpression(current.callee.object)
  }
  return t.isCallExpression(current) && t.isIdentifier(current.callee, { name: 'field' })
    ? current
    : null
}
