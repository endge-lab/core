import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/domain/types/source/source-engine.types'

import { compileStoreSource } from '@/model/services/source-engine/compilers/store-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { STORE_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/store.default.source'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/model/services/source-engine/value-expression-language'

export class StoreSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:store'
  public readonly sourceKind: SourceKind = 'store'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Store Source',
    extension: '.endge-store.ts',
    keywords: ['dataView', 'defineDataView', 'defineStore', 'derived', 'mock', 'select', 'value', ...VALUE_EXPRESSION_FUNCTION_NAMES],
    functions: ['dataView', 'derived', 'from', 'mock', 'select', 'value', ...VALUE_EXPRESSION_METHOD_NAMES],
    properties: ['data'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return STORE_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileStoreSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Store source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      { label: 'defineStore', kind: 'snippet', insertText: STORE_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Store source' },
      {
        label: 'mock',
        kind: 'function',
        insertText: "mock('identity')",
        detail: 'Получить initial value из Endge.mock registry',
      },
      {
        label: 'select',
        kind: 'function',
        insertText: `.select({\n  rows: path('items'),\n})`,
        detail: 'Inline DataView object projection',
      },
      ...VALUE_EXPRESSION_COMPLETIONS,
    ]
  }
}
