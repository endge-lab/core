import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/domain/types/source/source-engine.types'
import { compileActionSource } from '@/model/services/source-engine/compilers/action-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { resolveTypedSourceDocumentReference, typedSourceTypeReferenceHighlights } from '@/model/services/source-engine/source-document-reference'
import { ACTION_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/action.default.source'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/model/services/source-engine/value-expression-language'

export class ActionSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:action'
  public readonly sourceKind: SourceKind = 'action'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Action Source',
    extension: '.endge-action.ts',
    keywords: ['defineAction', 'input', 'output', 'query', 'update', 'action', 'computation', 'operation', 'typescript', 'runOutput', 'undoOutput', ...VALUE_EXPRESSION_FUNCTION_NAMES],
    functions: ['defineAction', 'field', 'input', 'output', 'query', 'update', 'action', 'computation', 'operation', 'typescript', 'runOutput', 'undoOutput', ...VALUE_EXPRESSION_METHOD_NAMES],
    properties: ['contract', 'steps', 'output', 'identity', 'input', 'run', 'undo', 'redo'],
  })
  public supports(sourceKind: SourceKind | string): boolean { return sourceKind === this.sourceKind }
  public createDefaultSource(): string { return ACTION_DEFAULT_SOURCE }
  public validate(source: string): SourceLanguageValidationResult {
    const result = compileActionSource({ source })
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Action source contains validation errors.' }
  }
  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      { label: 'defineAction', kind: 'snippet', insertText: ACTION_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Source Action' },
      { label: 'operation', kind: 'snippet', insertText: "operation({\n  input: {},\n  run: { steps: {} },\n  undo: { steps: {} },\n})", detail: 'Отменяемая операция; undo обязателен' },
      { label: 'query', kind: 'snippet', insertText: "query({ identity: 'query-identity', input: {} })", detail: 'Выполнить Query' },
      { label: 'update', kind: 'snippet', insertText: "update({ identity: 'update-identity', input: {} })", detail: 'Выполнить Update' },
      { label: 'action', kind: 'snippet', insertText: "action({ identity: 'action-identity', input: {} })", detail: 'Выполнить вложенный Action' },
      { label: 'computation', kind: 'snippet', insertText: "computation('computation-identity', {})", detail: 'Выполнить Computation' },
      { label: 'typescript', kind: 'snippet', insertText: 'typescript({\n  inputs: {},\n  compute(inputs) {\n    return inputs\n  },\n})', detail: 'Чистое sandbox-преобразование' },
      ...(_context.documentSymbols ?? [])
        .filter(symbol => ['action', 'query', 'update', 'computation', 'data-view', 'converter'].includes(symbol.target))
        .map(symbol => ({
          label: symbol.identity,
          kind: 'value' as const,
          insertText: symbol.identity,
          detail: `${symbol.target} identity`,
          documentation: [symbol.displayName, symbol.description].filter(Boolean).join('\n\n') || undefined,
        })),
      ...VALUE_EXPRESSION_COMPLETIONS,
    ]
  }
  public resolveReference(context: SourceLanguageContext) {
    return resolveTypedSourceDocumentReference(context, { functions: { action: 'action', query: 'query', update: 'update', computation: 'computation' } })
  }
  public semanticHighlights(context: SourceLanguageContext) { return typedSourceTypeReferenceHighlights(context) }
}
