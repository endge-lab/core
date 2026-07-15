import { parse } from '@babel/parser'
import * as t from '@babel/types'

import type { ComputationProgramPayload } from '@/domain/types/computation'
import type { ProgramDiagnostic } from '@/domain/types/program/program.types'
import { compileSourceExpression, unwrapExpression } from '@/model/services/source-engine/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

export interface ComputationCompileInput {
  implementationKind: 'source' | 'provider'
  sourceLanguage: 'typescript' | 'endge'
  source: string
  input: ComputationProgramPayload['input']
  output: ComputationProgramPayload['output']
}

export interface ComputationCompileResult {
  payload: ComputationProgramPayload
  diagnostics: DiagnosticDraft[]
}

/** Compiles one synchronous source computation into safe ValueExpression IR. */
export function compileComputation(input: ComputationCompileInput): ComputationCompileResult {
  const diagnostics: DiagnosticDraft[] = []
  const payload: ComputationProgramPayload = {
    implementationKind: input.implementationKind,
    sourceLanguage: input.sourceLanguage,
    input: input.input,
    output: input.output,
    expression: null,
  }

  if (input.implementationKind === 'provider') {
    diagnostics.push({
      severity: 'error',
      code: 'computation-provider-unsupported',
      message: 'Computation implementationKind "provider" пока не поддерживается runtime-ом.',
      sourcePath: 'implementationKind',
    })
    return { payload, diagnostics }
  }

  if (input.sourceLanguage !== 'typescript') {
    diagnostics.push({
      severity: 'error',
      code: 'computation-source-language-unsupported',
      message: `Computation sourceLanguage "${input.sourceLanguage}" пока не поддерживается.`,
      sourcePath: 'sourceLanguage',
    })
    return { payload, diagnostics }
  }

  let program: t.Program
  try {
    program = parse(input.source, {
      sourceType: 'module',
      plugins: ['typescript'],
    }).program
  }
  catch (error: any) {
    diagnostics.push({
      severity: 'error',
      code: 'computation-source-parse-error',
      message: `Не удалось разобрать computation source: ${error?.message ?? error}`,
      sourcePath: 'source',
      start: typeof error?.pos === 'number' ? error.pos : undefined,
    })
    return { payload, diagnostics }
  }

  for (const statement of program.body) {
    if (t.isImportDeclaration(statement)) {
      diagnostics.push(diagnostic(
        'computation-import-unsupported',
        'Imports запрещены в source computation.',
        statement,
      ))
      continue
    }
    if (
      !t.isExportDefaultDeclaration(statement)
      && !t.isTSInterfaceDeclaration(statement)
      && !t.isTSTypeAliasDeclaration(statement)
    ) diagnostics.push(diagnostic(
      'computation-top-level-unsupported',
      'Computation source допускает только type declarations и default function compute.',
      statement,
    ))
  }

  const exports = program.body.filter(t.isExportDefaultDeclaration)
  if (exports.length !== 1) {
    diagnostics.push({
      severity: 'error',
      code: 'computation-default-export-required',
      message: 'Computation должна содержать ровно один `export default function compute(...)`.',
      sourcePath: 'source',
    })
    return { payload, diagnostics }
  }

  const declaration = exports[0]!.declaration
  if (!t.isFunctionDeclaration(declaration) && !t.isFunctionExpression(declaration)) {
    diagnostics.push(diagnostic(
      'computation-function-required',
      'Default export computation должен быть function compute.',
      declaration,
    ))
    return { payload, diagnostics }
  }

  if (declaration.async || declaration.generator) {
    diagnostics.push(diagnostic(
      'computation-async-unsupported',
      'Computation должна быть синхронной function без generator.',
      declaration,
    ))
  }
  if (declaration.id?.name !== 'compute') {
    diagnostics.push(diagnostic(
      'computation-function-name',
      'Default function должна называться compute.',
      declaration.id,
    ))
  }
  if (declaration.params.length !== 1 || !t.isIdentifier(declaration.params[0])) {
    diagnostics.push(diagnostic(
      'computation-input-parameter',
      'Function compute должна принимать ровно один identifier input.',
      declaration,
    ))
    return { payload, diagnostics }
  }

  const executableStatements = declaration.body.body.filter(statement => !t.isEmptyStatement(statement))
  const returnStatement = executableStatements[0]
  if (executableStatements.length !== 1 || !t.isReturnStatement(returnStatement) || !returnStatement.argument) {
    diagnostics.push(diagnostic(
      'computation-single-return-required',
      'Body computation должен содержать только один `return expression`.',
      declaration.body,
    ))
    return { payload, diagnostics }
  }

  const rewritten = rewriteInputReads(returnStatement.argument, declaration.params[0].name, diagnostics)
  if (rewritten)
    payload.expression = compileSourceExpression(rewritten, diagnostics, 'source.return')

  return { payload, diagnostics }
}

function rewriteInputReads(
  raw: t.Expression,
  parameterName: string,
  diagnostics: DiagnosticDraft[],
): t.Expression | null {
  const node = unwrapExpression(raw)
  const path = readInputPath(node, parameterName)
  if (path != null)
    return t.callExpression(t.identifier('path'), [t.stringLiteral(path)])

  if (
    t.isStringLiteral(node)
    || t.isNumericLiteral(node)
    || t.isBooleanLiteral(node)
    || t.isNullLiteral(node)
    || t.isTemplateLiteral(node)
  ) return node

  if (t.isIdentifier(node, { name: 'undefined' }))
    return node

  if (t.isArrayExpression(node)) {
    return t.arrayExpression(node.elements.map((element) => {
      if (!element || !t.isExpression(element)) return null
      return rewriteInputReads(element, parameterName, diagnostics)
    }))
  }

  if (t.isObjectExpression(node)) {
    const properties: t.ObjectProperty[] = []
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed || !t.isExpression(property.value)) {
        diagnostics.push(diagnostic(
          'computation-object-property-unsupported',
          'Computation object поддерживает только обычные properties без spread/computed keys.',
          property,
        ))
        continue
      }
      const value = rewriteInputReads(property.value, parameterName, diagnostics)
      if (value)
        properties.push(t.objectProperty(property.key, value, false, property.shorthand))
    }
    return t.objectExpression(properties)
  }

  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const args: Array<t.Expression | t.SpreadElement | t.ArgumentPlaceholder> = []
    for (const argument of node.arguments) {
      if (!t.isExpression(argument)) {
        diagnostics.push(diagnostic(
          'computation-call-argument-unsupported',
          'Spread arguments запрещены в source computation.',
          argument,
        ))
        continue
      }
      const value = rewriteInputReads(argument, parameterName, diagnostics)
      if (value) args.push(value)
    }
    return t.callExpression(node.callee, args)
  }

  diagnostics.push(diagnostic(
    'computation-expression-unsupported',
    'Return expression использует синтаксис вне безопасного computation DSL.',
    node,
  ))
  return null
}

function readInputPath(node: t.Node, parameterName: string): string | null {
  if (t.isIdentifier(node))
    return node.name === parameterName ? '' : null

  if (!t.isMemberExpression(node) && !t.isOptionalMemberExpression(node))
    return null

  const parent = readInputPath(node.object, parameterName)
  if (parent == null)
    return null

  const property = !node.computed && t.isIdentifier(node.property)
    ? node.property.name
    : t.isStringLiteral(node.property) || t.isNumericLiteral(node.property)
      ? String(node.property.value)
      : null
  if (property == null)
    return null
  return parent ? `${parent}.${property}` : property
}

function diagnostic(
  code: string,
  message: string,
  node?: t.Node | null,
): DiagnosticDraft {
  return {
    severity: 'error',
    code,
    message,
    sourcePath: 'source',
    start: typeof node?.start === 'number' ? node.start : undefined,
    end: typeof node?.end === 'number' ? node.end : undefined,
  }
}
