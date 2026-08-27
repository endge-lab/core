import type { RComponentContractInput, RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFC_AST,
  RComponentSFC_AST_Attribute,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_TemplateNode,
} from '@/domain/types/component/sfc/ast.types'
import type {
  ComponentSFCAttributeAnalysisOptions,
  ComponentSFCTagAttributeContract,
  ComponentSFCTagAttributeLiteral,
} from '@/domain/types/component/sfc/tag-attribute-contract.types'
import { parse } from '@babel/parser'
import {
  getComponentSFCTagAttributeContracts,
} from '@/domain/types/component/sfc/tag-attribute-contract.types'

/** Проверяет статические значения конечных SFC-атрибутов по renderer-neutral контрактам. */
export function validateComponentSFCAttributeValues(
  source: string,
  ast: RComponentSFC_AST | null,
  options: ComponentSFCAttributeAnalysisOptions = {},
): RComponentDiagnostic[] {
  const diagnostics: RComponentDiagnostic[] = []
  for (const root of ast?.template?.roots ?? []) {
    visitNode(root, source, options, diagnostics)
  }
  return diagnostics
}

/** Возвращает встроенные и подключенные извне контракты без повторов имён. */
export function resolveComponentSFCTagAttributeContracts(
  tag: string,
  options: ComponentSFCAttributeAnalysisOptions = {},
): readonly ComponentSFCTagAttributeContract[] {
  const result: ComponentSFCTagAttributeContract[] = [...getComponentSFCTagAttributeContracts(tag)]
  const names = new Set(result.flatMap(contract => [contract.name, ...(contract.aliases ?? [])]))
  for (const contract of options.resolveTagAttributeContracts?.(tag) ?? []) {
    if (names.has(contract.name)) {
      continue
    }
    result.push(contract)
    names.add(contract.name)
    for (const alias of contract.aliases ?? []) {
      names.add(alias)
    }
  }
  return result
}

/** Преобразует literal-union inputs пользовательского компонента в editor-контракты. */
export function createComponentSFCAttributeContractsFromInputs(
  inputs: readonly RComponentContractInput[],
): ComponentSFCTagAttributeContract[] {
  return inputs.flatMap((input): ComponentSFCTagAttributeContract[] => {
    const values = extractLiteralUnionValues(input.type)
    if (values.length === 0) {
      return []
    }
    return [{
      name: input.name,
      values,
      description: `Входной параметр пользовательского компонента: ${input.type}.`,
    }]
  })
}

function visitNode(
  node: RComponentSFC_AST_TemplateNode,
  source: string,
  options: ComponentSFCAttributeAnalysisOptions,
  diagnostics: RComponentDiagnostic[],
): void {
  if (node.kind !== 'element') {
    return
  }
  validateElement(node, source, options, diagnostics)
  for (const child of node.children) {
    visitNode(child, source, options, diagnostics)
  }
}

function validateElement(
  node: RComponentSFC_AST_ElementNode,
  source: string,
  options: ComponentSFCAttributeAnalysisOptions,
  diagnostics: RComponentDiagnostic[],
): void {
  const contracts = resolveComponentSFCTagAttributeContracts(node.tag, options)
  for (const attribute of node.attributes) {
    const contract = contracts.find(item => (
      item.name === attribute.name || item.aliases?.includes(attribute.name)
    ))
    if (!contract || contract.validate === false) {
      continue
    }

    const value = readStaticAttributeValue(attribute)
    if (!value.known || contract.values.some(candidate => Object.is(candidate, value.value))) {
      continue
    }

    const range = attributeValueRange(source, attribute)
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-attribute-value-invalid',
      message: `<${node.tag}> ${attribute.name}="${String(value.value)}" не поддерживается. Используйте ${contract.values.map(formatLiteral).join(', ')}.`,
      sourcePath: `template.${node.tag}.${attribute.name}`,
      start: range.start,
      end: range.end,
    })
  }
}

function readStaticAttributeValue(
  attribute: RComponentSFC_AST_Attribute,
): { known: true, value: ComponentSFCTagAttributeLiteral } | { known: false } {
  if (!attribute.dynamic) {
    return attribute.value == null
      ? { known: true, value: true }
      : { known: true, value: attribute.value }
  }

  const source = attribute.value?.trim()
  if (!source) {
    return { known: false }
  }
  try {
    const expression = parse(`const __value = (${source})`, {
      sourceType: 'module',
      plugins: ['typescript'],
    }).program.body[0]
    if (expression?.type !== 'VariableDeclaration') {
      return { known: false }
    }
    const initializer = expression.declarations[0]?.init
    if (initializer?.type === 'StringLiteral' || initializer?.type === 'NumericLiteral' || initializer?.type === 'BooleanLiteral') {
      return { known: true, value: initializer.value }
    }
    if (initializer?.type === 'TemplateLiteral' && initializer.expressions.length === 0) {
      return { known: true, value: initializer.quasis[0]?.value.cooked ?? '' }
    }
  }
  catch {
    return { known: false }
  }
  return { known: false }
}

function attributeValueRange(
  source: string,
  attribute: RComponentSFC_AST_Attribute,
): { start: number, end: number } {
  const raw = source.slice(attribute.range.start, attribute.range.end)
  const value = attribute.value ?? ''
  const valueOffset = value ? raw.lastIndexOf(value) : -1
  if (valueOffset < 0) {
    return attribute.range
  }
  return {
    start: attribute.range.start + valueOffset,
    end: attribute.range.start + valueOffset + Math.max(1, value.length),
  }
}

function extractLiteralUnionValues(typeSource: string): ComponentSFCTagAttributeLiteral[] {
  try {
    const program = parse(`type __EndgeAttribute = ${typeSource}`, {
      sourceType: 'module',
      plugins: ['typescript'],
    }).program
    const alias = program.body[0]
    if (alias?.type !== 'TSTypeAliasDeclaration') {
      return []
    }
    const nodes = alias.typeAnnotation.type === 'TSUnionType'
      ? alias.typeAnnotation.types
      : [alias.typeAnnotation]
    const values: ComponentSFCTagAttributeLiteral[] = []
    for (const node of nodes) {
      if (node.type !== 'TSLiteralType') {
        return []
      }
      const literal = node.literal
      if (literal.type !== 'StringLiteral' && literal.type !== 'NumericLiteral' && literal.type !== 'BooleanLiteral') {
        return []
      }
      values.push(literal.value)
    }
    return values
  }
  catch {
    return []
  }
}

function formatLiteral(value: ComponentSFCTagAttributeLiteral): string {
  return typeof value === 'string' ? `"${value}"` : String(value)
}
