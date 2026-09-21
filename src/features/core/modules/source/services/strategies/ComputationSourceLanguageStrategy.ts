import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileComputation } from '@/features/core/modules/compiler/services/computation/computation-compile'
import { resolveTypedSourceDocumentReference, typedSourceTypeReferenceHighlights } from '@/features/core/modules/source/services/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import {
  VALUE_EXPRESSION_COMPLETIONS,
  VALUE_EXPRESSION_FUNCTION_NAMES,
  VALUE_EXPRESSION_METHOD_NAMES,
} from '@/features/core/modules/source/services/value-expression-language'
import { COMPUTATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/computation.default.source'

export class ComputationSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:computation'
  public readonly sourceKind: SourceKind = 'computation'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Computation Source',
    extension: '.endge-computation.ts',
    keywords: ['defineComputation', 'input', 'output', 'computation', 'typescript', ...VALUE_EXPRESSION_FUNCTION_NAMES],
    functions: ['defineComputation', 'field', 'input', 'output', 'computation', 'typescript', ...VALUE_EXPRESSION_METHOD_NAMES],
    properties: ['input', 'output', 'outputs', 'result', 'inputs', 'compute'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return COMPUTATION_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileComputation({ source })
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Computation source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      { label: 'defineComputation', kind: 'snippet', insertText: COMPUTATION_DEFAULT_SOURCE.trimEnd(), detail: 'Создать computation graph' },
      { label: 'field', kind: 'snippet', insertText: 'field(Type)', detail: 'Объявить input/output contract' },
      { label: 'typescript', kind: 'snippet', insertText: 'typescript({\n  inputs: {\n    value: input(\'value\'),\n  },\n  compute({ value }, api) {\n    return value\n  },\n})', detail: 'Sandboxed TypeScript output node' },
      { label: 'computation', kind: 'snippet', insertText: 'computation(\'identity\', {\n  value: input(\'value\'),\n})', detail: 'Вызвать внешний computation' },
      { label: 'input', kind: 'function', insertText: 'input(\'path\')', detail: 'Прочитать внешний computation input' },
      { label: 'output', kind: 'function', insertText: 'output(\'name\')', detail: 'Прочитать named output' },
      ...VALUE_EXPRESSION_COMPLETIONS,
    ]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveTypedSourceDocumentReference(context, {
      functions: {
        computation: 'computation',
      },
    })
  }

  public semanticHighlights(context: SourceLanguageContext) {
    return typedSourceTypeReferenceHighlights(context)
  }
}
