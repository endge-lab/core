import type {
  FilterProgramOutput,
  FilterProgramPayload,
  FilterSourceCompileResult,
  FilterSourceDocument,
} from '@/domain/types/source/filter-source.types'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import type { SourceExpressionIR, SourceFieldDefinition } from '@/domain/types/source/source-expression.types'

import { parse as parseTS } from '@babel/parser'
import * as t from '@babel/types'

import {
  compileSourceCallback,
  diagnostic,
  propertyName,
  unwrapExpression,
} from '@/model/services/source-engine/compilers/source-expression-compile'
import { compileSourceField } from '@/model/services/source-engine/compilers/source-field-compile'
import { compileProgramMetadataProperty } from '@/model/services/source-engine/compilers/source-metadata-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

/** Компилирует Filter source v1 в normalized document и artifact payload. */
export function compileFilterSource(source: string, sourceVersion = 1): FilterSourceCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  if (!String(source ?? '').trim()) {
    diagnostics.push(diagnostic('error', 'filter-source-empty', 'Filter source пуст. Legacy fields не используются новым runtime.'))
    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
  }

  try {
    const ast = parseTS(source, { sourceType: 'module', plugins: ['typescript'] })
    const call = findDefineFilter(ast)
    const definition = call?.arguments[0]
    if (!call) {
      diagnostics.push(diagnostic('error', 'filter-source-define-missing', 'Filter source должен содержать defineFilter({...}).'))
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }
    if (!definition || !t.isObjectExpression(definition)) {
      diagnostics.push(diagnostic('error', 'filter-source-definition', 'defineFilter принимает объектный литерал.', 'defineFilter', call))
      return { ast, document: null, artifact: null, metadata: {}, diagnostics }
    }

    const unsupported = definition.properties.filter(property => {
      if (!t.isObjectProperty(property) || property.computed)
        return true
      const name = propertyName(property.key)
      return name !== 'metadata' && name !== 'fields' && name !== 'outputs'
    })
    for (const property of unsupported)
      diagnostics.push(diagnostic('error', 'filter-source-property-unsupported', 'defineFilter v1 поддерживает только metadata, fields и outputs.', 'defineFilter', property))

    const metadata = compileProgramMetadataProperty(definition, diagnostics)
    const fieldsNode = objectProperty(definition, 'fields')
    const outputsNode = objectProperty(definition, 'outputs')
    const fields = fieldsNode ? readFields(fieldsNode, source, diagnostics) : []
    const outputs = outputsNode ? readOutputs(outputsNode, diagnostics) : []
    if (!fieldsNode)
      diagnostics.push(diagnostic('error', 'filter-source-fields-missing', 'defineFilter требует fields.', 'fields', definition))
    if (!outputsNode)
      diagnostics.push(diagnostic('error', 'filter-source-outputs-missing', 'defineFilter требует outputs.', 'outputs', definition))

    const hasErrors = diagnostics.some(item => item.severity === 'error')
    const document: FilterSourceDocument = { fields, outputs }
    const artifact: FilterProgramPayload = {
      type: 'filter',
      sourceVersion,
      fields,
      defaults: Object.fromEntries(fields.map(field => [field.key, field.defaultValue])),
      outputs,
    }
    return {
      ast,
      document: hasErrors ? null : document,
      artifact: hasErrors ? null : artifact,
      metadata,
      diagnostics,
    }
  }
  catch (error: any) {
    diagnostics.push(diagnostic('error', 'filter-source-parse-error', `Не удалось распарсить Filter source: ${error?.message ?? error}`))
    return { ast: null, document: null, artifact: null, metadata: {}, diagnostics }
  }
}

function findDefineFilter(ast: t.File): t.CallExpression | null {
  for (const statement of ast.program.body) {
    if (!t.isExpressionStatement(statement))
      continue
    const expression = unwrapExpression(statement.expression)
    if (t.isCallExpression(expression) && t.isIdentifier(expression.callee, { name: 'defineFilter' }))
      return expression
  }
  return null
}

function readFields(
  node: t.ObjectExpression,
  source: string,
  diagnostics: DiagnosticDraft[],
): SourceFieldDefinition[] {
  const fields: SourceFieldDefinition[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'filter-source-field-property', 'fields допускает только обычные object properties.', 'fields', property))
      continue
    }
    const key = propertyName(property.key)
    if (!key)
      continue
    if (declared.has(key)) {
      diagnostics.push(diagnostic('error', 'filter-source-field-duplicate', `Field "${key}" объявлен повторно.`, `fields.${key}`, property))
      continue
    }
    declared.add(key)
    const parsed = compileSourceField(key, property.value, source, diagnostics, `fields.${key}`)
    if (parsed) {
      if (parsed.defaultSource)
        diagnostics.push(diagnostic('error', 'filter-source-field-from-unsupported', '.from(...) поддерживается только в defineProps.', `fields.${key}.from`, property))
      fields.push(parsed.field)
    }
  }
  return fields
}

function readOutputs(
  node: t.ObjectExpression,
  diagnostics: DiagnosticDraft[],
): FilterProgramOutput[] {
  const outputs: FilterProgramOutput[] = []
  const declared = new Set<string>()
  for (const property of node.properties) {
    if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
      diagnostics.push(diagnostic('error', 'filter-source-output-property', 'outputs допускает только обычные object properties.', 'outputs', property))
      continue
    }
    const key = propertyName(property.key)
    if (!key)
      continue
    if (declared.has(key)) {
      diagnostics.push(diagnostic('error', 'filter-source-output-duplicate', `Output "${key}" объявлен повторно.`, `outputs.${key}`, property))
      continue
    }
    declared.add(key)
    const output = readOutput(key, property.value, diagnostics)
    if (output)
      outputs.push(output)
  }
  return outputs
}

function readOutput(
  key: string,
  raw: t.Expression,
  diagnostics: DiagnosticDraft[],
): FilterProgramOutput | null {
  const expression = unwrapExpression(raw)
  if (!t.isCallExpression(expression) || !t.isMemberExpression(expression.callee))
    return unsupportedOutput(key, raw, diagnostics)

  const method = propertyName(expression.callee.property)
  const base = t.isExpression(expression.callee.object) ? unwrapExpression(expression.callee.object) : null
  if (!method || !base || !t.isCallExpression(base) || !t.isIdentifier(base.callee, { name: 'output' }))
    return unsupportedOutput(key, raw, diagnostics)

  if (method === 'json' || method === 'predicate') {
    const compiled = compileSourceCallback(expression.arguments[0], diagnostics, `outputs.${key}`)
    if (!compiled)
      return null
    validateOutputExpression(method, compiled, diagnostics, `outputs.${key}`)
    return method === 'json'
      ? { key, kind: 'json', expression: compiled }
      : { key, kind: 'predicate', expression: compiled }
  }

  diagnostics.push(diagnostic('error', 'filter-source-output-method', `output().${method}(...) не поддерживается.`, `outputs.${key}`, expression))
  return null
}

function validateOutputExpression(
  kind: 'json' | 'predicate',
  expression: SourceExpressionIR,
  diagnostics: DiagnosticDraft[],
  sourcePath: string,
): void {
  const allowedOperations = kind === 'json'
    ? new Set(['merge', 'compact', 'in-list'])
    : new Set(['and', 'between', 'in-array'])
  const allowedReads = kind === 'json'
    ? new Set(['value'])
    : new Set(['row', 'value'])

  const visit = (node: SourceExpressionIR) => {
    if (node.type === 'operation') {
      if (!allowedOperations.has(node.operation)) {
        diagnostics.push(diagnostic(
          'error',
          'filter-source-output-operation',
          `Operation "${node.operation}" недопустима для ${kind} output.`,
          sourcePath,
        ))
      }
      node.arguments.forEach(visit)
    }
    else if (node.type === 'read') {
      if (!allowedReads.has(node.source)) {
        diagnostics.push(diagnostic(
          'error',
          'filter-source-output-read',
          `Read source "${node.source}" недопустим для ${kind} output.`,
          sourcePath,
        ))
      }
    }
    else if (node.type === 'array') {
      node.items.forEach(visit)
    }
    else if (node.type === 'object') {
      Object.values(node.properties).forEach(visit)
    }
  }
  visit(expression)
}

function unsupportedOutput(key: string, node: t.Node, diagnostics: DiagnosticDraft[]): null {
  diagnostics.push(diagnostic('error', 'filter-source-output-shape', `Output "${key}" должен быть output().json/predicate.`, `outputs.${key}`, node))
  return null
}

function objectProperty(node: t.ObjectExpression, name: string): t.ObjectExpression | null {
  for (const property of node.properties) {
    if (
      t.isObjectProperty(property)
      && !property.computed
      && propertyName(property.key) === name
      && t.isObjectExpression(property.value)
    ) {
      return property.value
    }
  }
  return null
}
