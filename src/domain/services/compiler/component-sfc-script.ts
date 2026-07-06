import { parse as parseTS } from '@babel/parser'

import type { RComponentContract, RComponentDiagnostic } from '@/domain/types/component-core.types'
import { createEmptyComponentContract } from '@/domain/types/component-core.types'
import type {
  RComponentSFC_AST_Script,
  RComponentSFC_IR_LocalBinding,
  RComponentSFC_IR_Prop,
} from '@/domain/types/component-sfc.types'

/** Результат анализа script-секции SFC. */
export interface ComponentSFCScriptAnalysisResult {
  /** Контракт компонента, извлеченный из defineProps. */
  contract: RComponentContract

  /** IR props компонента. */
  props: RComponentSFC_IR_Prop[]

  /** Локальные bindings script setup. */
  locals: RComponentSFC_IR_LocalBinding[]

  /** Preview-only props для SFC Playground. Не входят в runtime contract. */
  previewProps: Record<string, unknown> | null

  /** Diagnostics script pass. */
  diagnostics: RComponentDiagnostic[]
}

/** Анализирует script setup и извлекает контракт/locals для IR. */
export function analyzeComponentSFCScript(script: RComponentSFC_AST_Script | null): ComponentSFCScriptAnalysisResult {
  const diagnostics: RComponentDiagnostic[] = []
  const contract = createEmptyComponentContract()

  if (!script) {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-script-missing',
      message: 'SFC-компонент не содержит script setup. Props будут пустыми.',
      sourcePath: 'script',
    })

    return {
      contract,
      props: [],
      locals: [],
      previewProps: null,
      diagnostics,
    }
  }

  if (script.lang && script.lang !== 'ts') {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-script-lang-unsupported',
      message: `Для SFC v1 ожидается script lang="ts", получено "${script.lang}".`,
      sourcePath: 'script',
    })
  }

  const props = script.props
    ? parsePropsSource(script.props.source)
    : []
  const previewPropsResult = script.previewProps
    ? parsePreviewPropsSource(script.previewProps.source)
    : { value: null, diagnostics: [] }

  diagnostics.push(...previewPropsResult.diagnostics)

  contract.inputs = props.map(prop => ({
    name: prop.name,
    type: prop.type,
    isArray: prop.isArray,
    optional: prop.optional,
  }))

  return {
    contract,
    props,
    locals: script.bindings
      .filter(binding => binding.kind !== 'prop')
      .map(binding => ({
        name: binding.name,
        sourceRange: binding.range,
      })),
    previewProps: previewPropsResult.value,
    diagnostics,
  }
}

function parsePropsSource(source: string): RComponentSFC_IR_Prop[] {
  const props: RComponentSFC_IR_Prop[] = []
  const body = source
    .trim()
    .replace(/^\{/, '')
    .replace(/\}$/, '')

  for (const chunk of body.split(/[;\n,]+/)) {
    const line = chunk.trim()
    if (!line)
      continue

    const match = line.match(/^([A-Za-z_$][\w$]*)(\?)?\s*:\s*(.+)$/)
    if (!match)
      continue

    const type = match[3].trim()
    props.push({
      name: match[1],
      type,
      isArray: /\[\]$/.test(type) || /^Array<.+>$/.test(type),
      optional: Boolean(match[2]),
    })
  }

  return props
}

function parsePreviewPropsSource(source: string): { value: Record<string, unknown> | null, diagnostics: RComponentDiagnostic[] } {
  try {
    const ast = parseTS(`const __preview = ${source}`, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any
    const declaration = ast.program.body[0]?.declarations?.[0]
    const value = readPreviewLiteral(declaration?.init)

    if (value.ok && value.value && typeof value.value === 'object' && !Array.isArray(value.value)) {
      return {
        value: value.value as Record<string, unknown>,
        diagnostics: [],
      }
    }
  }
  catch {
    return {
      value: null,
      diagnostics: [{
        severity: 'warning',
        code: 'sfc-preview-props-invalid',
        message: 'definePreviewProps должен содержать валидный object literal.',
        sourcePath: 'script',
      }],
    }
  }

  return {
    value: null,
    diagnostics: [{
      severity: 'warning',
      code: 'sfc-preview-props-unsupported',
      message: 'definePreviewProps поддерживает только object literal с literal-значениями.',
      sourcePath: 'script',
    }],
  }
}

function readPreviewLiteral(node: any): { ok: true, value: unknown } | { ok: false } {
  if (!node)
    return { ok: false }

  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression' || node.type === 'TypeCastExpression')
    return readPreviewLiteral(node.expression)

  if (node.type === 'StringLiteral' || node.type === 'NumericLiteral' || node.type === 'BooleanLiteral')
    return { ok: true, value: node.value }

  if (node.type === 'NullLiteral')
    return { ok: true, value: null }

  if (node.type === 'UnaryExpression' && node.operator === '-') {
    const value = readPreviewLiteral(node.argument)
    if (value.ok && typeof value.value === 'number')
      return { ok: true, value: -value.value }
    return { ok: false }
  }

  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0)
    return { ok: true, value: node.quasis?.[0]?.value?.cooked ?? '' }

  if (node.type === 'ArrayExpression') {
    const items: unknown[] = []
    for (const item of node.elements ?? []) {
      const value = readPreviewLiteral(item)
      if (!value.ok)
        return { ok: false }
      items.push(value.value)
    }
    return { ok: true, value: items }
  }

  if (node.type === 'ObjectExpression') {
    const object: Record<string, unknown> = {}
    for (const property of node.properties ?? []) {
      if (property.type !== 'ObjectProperty' || property.computed)
        return { ok: false }

      const key = readObjectKey(property.key)
      const value = readPreviewLiteral(property.value)
      if (!key || !value.ok)
        return { ok: false }

      object[key] = value.value
    }
    return { ok: true, value: object }
  }

  return { ok: false }
}

function readObjectKey(node: any): string | null {
  if (node?.type === 'Identifier')
    return node.name
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral')
    return String(node.value)
  return null
}
