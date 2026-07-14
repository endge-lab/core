import { parse as parseTS } from '@babel/parser'

import type { RComponentContract, RComponentDiagnostic } from '@/domain/types/component-core.types'
import { createEmptyComponentContract } from '@/domain/types/component-core.types'
import type {
  ComponentSFCPreviewLiteral,
  ComponentSFCPreviewOptions,
  ComponentSFCPreviewProps,
  ComponentSFCPreviewRunTarget,
} from '@/domain/types/program.types'
import type {
  RComponentSFC_AST_Script,
  RComponentSFC_IR_LocalBinding,
  RComponentSFC_IR_Prop,
} from '@/domain/types/component-sfc.types'
import type { ProgramMetadataMap } from '@/domain/types/program-metadata.types'
import { compileProgramMetadataSource } from '@/model/services/source-engine/source-metadata-compile'

/** Результат анализа script-секции SFC. */
export interface ComponentSFCScriptAnalysisResult {
  /** Контракт компонента, извлеченный из defineProps. */
  contract: RComponentContract

  /** IR props компонента. */
  props: RComponentSFC_IR_Prop[]

  /** Локальные bindings script setup. */
  locals: RComponentSFC_IR_LocalBinding[]

  /** Preview-only props для SFC Playground. Не входят в runtime contract. */
  previewProps: ComponentSFCPreviewProps | null

  /** Preview-only runtime options для запуска песочницы компонента. */
  previewOptions: ComponentSFCPreviewOptions | null

  /** Публичная metadata компонента из defineMetadata. */
  metadata: ProgramMetadataMap

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
      previewOptions: null,
      metadata: {},
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
    ? parsePreviewPropsSource(script.previewProps.source, script.previewProps.optionsSource)
    : { props: null, options: null, diagnostics: [] }

  diagnostics.push(...previewPropsResult.diagnostics)

  if (script.metadata.length > 1) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-metadata-duplicate',
      message: 'SFC-компонент допускает только один вызов defineMetadata.',
      sourcePath: 'script.defineMetadata',
      start: script.metadata[1].range.start,
      end: script.metadata[1].range.end,
    })
  }
  const metadata = script.metadata[0]
    ? compileProgramMetadataSource(script.metadata[0].source, diagnostics, 'script.defineMetadata')
    : {}

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
    previewProps: previewPropsResult.props,
    previewOptions: previewPropsResult.options,
    metadata,
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

function parsePreviewPropsSource(
  source: string,
  optionsSource?: string | null,
): { props: ComponentSFCPreviewProps | null, options: ComponentSFCPreviewOptions | null, diagnostics: RComponentDiagnostic[] } {
  const diagnostics: RComponentDiagnostic[] = []

  try {
    const ast = parseTS(`const __preview = ${source}`, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any
    const declaration = ast.program.body[0]?.declarations?.[0]
    const value = readPreviewPropsObject(declaration?.init)

    if (value.ok && value.value && typeof value.value === 'object' && !Array.isArray(value.value)) {
      const options = optionsSource
        ? parsePreviewOptionsSource(optionsSource, diagnostics)
        : null
      return {
        props: value.value as ComponentSFCPreviewProps,
        options,
        diagnostics,
      }
    }
  }
  catch {
    return {
      props: null,
      options: null,
      diagnostics: [{
        severity: 'warning',
        code: 'sfc-preview-props-invalid',
        message: 'definePreviewProps должен содержать валидный object literal.',
        sourcePath: 'script',
      }],
    }
  }

  return {
    props: null,
    options: null,
    diagnostics: [{
      severity: 'warning',
      code: 'sfc-preview-props-unsupported',
      message: 'definePreviewProps поддерживает literal, fromStore("path") или fromData("store.path").',
      sourcePath: 'script',
    }],
  }
}

function parsePreviewOptionsSource(
  source: string,
  diagnostics: RComponentDiagnostic[],
): ComponentSFCPreviewOptions | null {
  try {
    const ast = parseTS(`const __previewOptions = ${source}`, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any
    const declaration = ast.program.body[0]?.declarations?.[0]
    const value = readPreviewOptionsObject(declaration?.init)
    if (value.ok)
      return value.value
  }
  catch {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-preview-options-invalid',
      message: 'Второй аргумент definePreviewProps должен быть валидным object literal.',
      sourcePath: 'script',
    })
    return null
  }

  diagnostics.push({
    severity: 'warning',
    code: 'sfc-preview-options-unsupported',
    message: 'definePreviewProps options поддерживает seed и run: [query("identity").storeTo(store("identity"), mapping)].',
    sourcePath: 'script',
  })
  return null
}

function readPreviewPropsObject(node: any): { ok: true, value: ComponentSFCPreviewProps } | { ok: false } {
  const expression = unwrapPreviewExpression(node)
  if (!expression || expression.type !== 'ObjectExpression')
    return { ok: false }

  const object: ComponentSFCPreviewProps = {}
  for (const property of expression.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed)
      return { ok: false }

    const key = readObjectKey(property.key)
    const value = readPreviewPropValue(property.value)
    if (!key || !value.ok)
      return { ok: false }

    object[key] = value.value
  }

  return { ok: true, value: object }
}

function readPreviewPropValue(node: any): { ok: true, value: ComponentSFCPreviewProps[string] } | { ok: false } {
  const expression = unwrapPreviewExpression(node)
  const storeRef = readFromStoreExpression(expression)
  if (storeRef)
    return { ok: true, value: storeRef }
  const dataRef = readFromDataExpression(expression)
  if (dataRef)
    return { ok: true, value: dataRef }

  return readPreviewLiteral(expression)
}

function readPreviewOptionsObject(node: any): { ok: true, value: ComponentSFCPreviewOptions } | { ok: false } {
  const expression = unwrapPreviewExpression(node)
  if (!expression || expression.type !== 'ObjectExpression')
    return { ok: false }

  const options: ComponentSFCPreviewOptions = {}
  for (const property of expression.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed)
      return { ok: false }

    const key = readObjectKey(property.key)
    if (key === 'seed') {
      const value = readPreviewLiteral(property.value)
      if (!value.ok || !value.value || typeof value.value !== 'object' || Array.isArray(value.value))
        return { ok: false }
      options.seed = value.value as Record<string, ComponentSFCPreviewLiteral>
      continue
    }

    if (key === 'run') {
      const value = readPreviewRunTargets(property.value)
      if (!value.ok)
        return { ok: false }
      options.run = value.value
      continue
    }

    return { ok: false }
  }

  return { ok: true, value: options }
}

function readPreviewRunTargets(node: any): { ok: true, value: ComponentSFCPreviewOptions['run'] } | { ok: false } {
  const expression = unwrapPreviewExpression(node)
  if (!expression || expression.type !== 'ArrayExpression')
    return { ok: false }

  const run: NonNullable<ComponentSFCPreviewOptions['run']> = []
  for (const item of expression.elements ?? []) {
    const queryRef = readQueryExpression(unwrapPreviewExpression(item))
    if (!queryRef)
      return { ok: false }
    run.push(queryRef)
  }

  return { ok: true, value: run }
}

function readFromStoreExpression(node: any): { type: 'store', path: string } | null {
  if (
    node?.type !== 'CallExpression'
    || node.callee?.type !== 'Identifier'
    || node.callee.name !== 'fromStore'
  ) {
    return null
  }

  const argument = readPreviewLiteral(node.arguments?.[0])
  return argument.ok && typeof argument.value === 'string'
    ? { type: 'store', path: argument.value }
    : null
}

function readFromDataExpression(node: any): { type: 'data', store: string, path: string } | null {
  if (
    node?.type !== 'CallExpression'
    || node.callee?.type !== 'Identifier'
    || node.callee.name !== 'fromData'
  ) {
    return null
  }

  const argument = readPreviewLiteral(node.arguments?.[0])
  if (!argument.ok || typeof argument.value !== 'string')
    return null
  const dot = argument.value.indexOf('.')
  return dot > 0 && dot < argument.value.length - 1
    ? { type: 'data', store: argument.value.slice(0, dot), path: argument.value.slice(dot + 1) }
    : null
}

function readQueryExpression(node: any): ComponentSFCPreviewRunTarget | null {
  node = unwrapPreviewExpression(node)
  if (node?.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'query') {
    const argument = readPreviewLiteral(node.arguments?.[0])
    return argument.ok && typeof argument.value === 'string'
      ? { type: 'query', identity: argument.value }
      : null
  }

  if (
    node?.type !== 'CallExpression'
    || node.callee?.type !== 'MemberExpression'
    || node.callee.computed
    || node.callee.property?.type !== 'Identifier'
    || node.callee.property.name !== 'storeTo'
  ) {
    return null
  }

  const queryRef = readQueryExpression(node.callee.object)
  const store = readStoreExpression(node.arguments?.[0])
  const fields = readPreviewStoreMapping(node.arguments?.[1])
  if (!queryRef || queryRef.storeTo || !store || !fields)
    return null

  return {
    ...queryRef,
    storeTo: { store, fields },
  }
}

function readStoreExpression(node: any): string | null {
  node = unwrapPreviewExpression(node)
  if (node?.type !== 'CallExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 'store')
    return null
  const argument = readPreviewLiteral(node.arguments?.[0])
  return argument.ok && typeof argument.value === 'string' && argument.value.trim()
    ? argument.value
    : null
}

function readPreviewStoreMapping(node: any): Record<string, string> | null {
  node = unwrapPreviewExpression(node)
  const shorthand = readPreviewLiteral(node)
  if (shorthand.ok && typeof shorthand.value === 'string' && shorthand.value.trim())
    return { [shorthand.value]: shorthand.value }
  if (node?.type !== 'ObjectExpression')
    return null

  const fields: Record<string, string> = {}
  for (const property of node.properties ?? []) {
    if (property.type !== 'ObjectProperty' || property.computed)
      return null
    const target = readObjectKey(property.key)
    const output = readOutputExpression(property.value)
    if (!target || !output)
      return null
    fields[target] = output
  }
  return Object.keys(fields).length ? fields : null
}

function readOutputExpression(node: any): string | null {
  node = unwrapPreviewExpression(node)
  if (node?.type !== 'CallExpression' || node.callee?.type !== 'Identifier' || node.callee.name !== 'output')
    return null
  const argument = readPreviewLiteral(node.arguments?.[0])
  return argument.ok && typeof argument.value === 'string' && argument.value.trim()
    ? argument.value
    : null
}

function readPreviewLiteral(node: any): { ok: true, value: ComponentSFCPreviewLiteral } | { ok: false } {
  node = unwrapPreviewExpression(node)
  if (!node)
    return { ok: false }

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
    const items: ComponentSFCPreviewLiteral[] = []
    for (const item of node.elements ?? []) {
      const value = readPreviewLiteral(item)
      if (!value.ok)
        return { ok: false }
      items.push(value.value)
    }
    return { ok: true, value: items }
  }

  if (node.type === 'ObjectExpression') {
    const object: Record<string, ComponentSFCPreviewLiteral> = {}
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

function unwrapPreviewExpression(node: any): any {
  let current = node
  while (
    current?.type === 'TSAsExpression'
    || current?.type === 'TSSatisfiesExpression'
    || current?.type === 'TypeCastExpression'
    || current?.type === 'ParenthesizedExpression'
  ) {
    current = current.expression
  }
  return current
}

function readObjectKey(node: any): string | null {
  if (node?.type === 'Identifier')
    return node.name
  if (node?.type === 'StringLiteral' || node?.type === 'NumericLiteral')
    return String(node.value)
  return null
}
