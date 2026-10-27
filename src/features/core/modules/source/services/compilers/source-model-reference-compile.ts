import type { ProgramDiagnostic } from '@/features/core/modules/program/domain/types/program.types'
import type { DataViewExternalRef, DataViewInlineRef } from '@/features/core/modules/source/domain/types/data-view-source.types'

import * as t from '@babel/types'

import { diagnostic, isContextSwitchCall, selectContextSwitchNode } from '@/features/core/modules/source/services/compilers/source-expression-compile'

type DiagnosticDraft = Omit<ProgramDiagnostic, 'entityRef'>

type ParsedSourceModelReferenceBranch
  = | { kind: 'external', identity: string }
    | { kind: 'inline', source: string, definition: t.CallExpression }

// variants — все ветки contextSwitch (default первым); у обычной ссылки отсутствует.
export type ParsedSourceModelReference = ParsedSourceModelReferenceBranch & { variants?: ParsedSourceModelReferenceBranch[] }

// Ссылка на DataView в compiled Source: выбранная ветка и ветки contextSwitch для проверки при сборке.
export function toDataViewRef(reference: ParsedSourceModelReference): DataViewExternalRef | DataViewInlineRef {
  const strip = (branch: ParsedSourceModelReferenceBranch): DataViewExternalRef | DataViewInlineRef => branch.kind === 'external'
    ? { kind: 'external', identity: branch.identity }
    : { kind: 'inline', source: branch.source }
  return reference.variants
    ? { ...strip(reference), contextVariants: reference.variants.map(strip) }
    : strip(reference)
}

// Читает canonical string identity или legacy wrapper model('identity').
export function readSourceModelIdentity(
  raw: t.CallExpression['arguments'][number] | undefined,
  referenceCall: string,
): string | null {
  if (!raw || !t.isExpression(raw)) {
    return null
  }

  const expression = unwrapExpression(raw)
  if (t.isStringLiteral(expression)) {
    return expression.value.trim() ? expression.value : null
  }

  if (!t.isCallExpression(expression) || !t.isIdentifier(expression.callee, { name: referenceCall })) {
    return null
  }

  const identity = expression.arguments[0]
  return identity && t.isStringLiteral(identity) && identity.value.trim()
    ? identity.value
    : null
}

// Нормализует shorthand, legacy external wrapper и inline define-call в общий reference contract.
export function readSourceModelReference(
  raw: t.CallExpression['arguments'][number] | undefined,
  source: string,
  options: {
    referenceCall: string
    defineCall: string
    // Разрешает contextSwitch({ default, cases }) ссылок; без diagnostics contextSwitch не распознаётся.
    diagnostics?: DiagnosticDraft[]
    sourcePath?: string
  },
): ParsedSourceModelReference | null {
  const switchNode = raw && t.isExpression(raw) ? unwrapExpression(raw) : null
  if (options.diagnostics && switchNode && t.isCallExpression(switchNode) && isContextSwitchCall(switchNode)) {
    const diagnostics = options.diagnostics
    const sourcePath = options.sourcePath ?? options.referenceCall
    const result = selectContextSwitchNode<ParsedSourceModelReferenceBranch>(switchNode, diagnostics, sourcePath, (branch, branchDiagnostics, branchPath) => {
      const reference = readSourceModelReference(branch, source, { referenceCall: options.referenceCall, defineCall: options.defineCall })
      if (!reference) {
        branchDiagnostics.push(diagnostic('error', 'source-reference-context-switch-branch', `Ветка contextSwitch должна быть ссылкой "identity", ${options.referenceCall}('identity') или ${options.defineCall}({...}).`, branchPath, branch))
      }
      return reference
    })
    return result ? { ...result.selected, variants: result.variants } : null
  }
  const identity = readSourceModelIdentity(raw, options.referenceCall)
  if (identity) {
    return { kind: 'external', identity }
  }

  if (!raw || !t.isExpression(raw)) {
    return null
  }
  const expression = unwrapExpression(raw)
  if (!t.isCallExpression(expression)
    || !t.isIdentifier(expression.callee, { name: options.defineCall })
    || expression.start == null
    || expression.end == null) {
    return null
  }

  return {
    kind: 'inline',
    source: source.slice(expression.start, expression.end),
    definition: expression,
  }
}

function unwrapExpression<T extends t.Expression>(node: T): t.Expression {
  let current: t.Expression = node
  while (t.isTSAsExpression(current) || t.isTSTypeAssertion(current) || t.isTSNonNullExpression(current) || t.isParenthesizedExpression(current)) {
    current = current.expression
  }
  return current
}
