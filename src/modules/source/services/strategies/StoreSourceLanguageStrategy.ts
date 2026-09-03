import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/modules/source/domain/types/source-engine.types'

import { compileStoreSource } from '@/modules/source/services/compilers/store-source-compile'
import { resolveTypedSourceDocumentReference, typedSourceTypeReferenceHighlights } from '@/modules/source/services/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/modules/source/services/source-language-syntax'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/modules/source/services/value-expression-language'
import { STORE_DEFAULT_SOURCE } from '@/modules/source/templates/store.default.source'

export class StoreSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:store'
  public readonly sourceKind: SourceKind = 'store'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Store Source',
    extension: '.endge-store.ts',
    keywords: ['contract', 'converter', 'dataView', 'defineDataView', 'defineStore', 'derived', 'field', 'mock', 'select', 'value', ...VALUE_EXPRESSION_FUNCTION_NAMES],
    functions: ['contract', 'converter', 'dataView', 'derived', 'field', 'from', 'mock', 'select', 'value', ...VALUE_EXPRESSION_METHOD_NAMES],
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
        insertText: 'mock(\'identity\')',
        detail: 'Получить initial value из Endge.mock registry',
      },
      {
        label: 'dataView',
        kind: 'function',
        insertText: '.dataView(\'data-view-identity\')',
        detail: 'Применить внешний DataView',
      },
      {
        label: 'contract',
        kind: 'function',
        insertText: '.contract(field(TypeIdentity).array())',
        detail: 'Тип значения Store field',
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

  public resolveReference(context: SourceLanguageContext) {
    return resolveTypedSourceDocumentReference(context, {
      functions: {
        converter: 'converter',
        dataView: 'data-view',
        mock: 'mock',
      },
      methods: {
        convert: 'converter',
        dataView: 'data-view',
      },
    })
  }

  public semanticHighlights(context: SourceLanguageContext) {
    return typedSourceTypeReferenceHighlights(context)
  }
}
