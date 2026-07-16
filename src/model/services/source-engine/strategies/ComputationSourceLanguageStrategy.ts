import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { compileComputation } from '@/model/services/compiler/computation/computation-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { COMPUTATION_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/computation.default.source'
import {
  VALUE_EXPRESSION_COMPLETIONS,
  VALUE_EXPRESSION_FUNCTION_NAMES,
  VALUE_EXPRESSION_METHOD_NAMES,
} from '@/model/services/source-engine/value-expression-language'

export class ComputationSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:computation'
  public readonly sourceKind: SourceKind = 'computation'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Computation Source',
    extension: '.endge-computation.ts',
    keywords: ['defineComputation', 'input', 'output', 'typescript', ...VALUE_EXPRESSION_FUNCTION_NAMES],
    functions: ['defineComputation', 'input', 'output', 'typescript', ...VALUE_EXPRESSION_METHOD_NAMES],
    properties: ['outputs', 'result', 'inputs', 'compute'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return COMPUTATION_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileComputation({ source, input: null, output: null })
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Computation source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      { label: 'defineComputation', kind: 'snippet', insertText: COMPUTATION_DEFAULT_SOURCE.trimEnd(), detail: 'Создать computation graph' },
      { label: 'typescript', kind: 'snippet', insertText: "typescript({\n  inputs: {\n    value: input('value'),\n  },\n  compute({ value }, api) {\n    return value\n  },\n})", detail: 'Sandboxed TypeScript output node' },
      { label: 'input', kind: 'function', insertText: "input('path')", detail: 'Прочитать внешний computation input' },
      { label: 'output', kind: 'function', insertText: "output('name')", detail: 'Прочитать named output' },
      ...VALUE_EXPRESSION_COMPLETIONS,
    ]
  }
}
