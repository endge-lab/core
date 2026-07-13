import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source-engine.types'

import { compileFilterSource } from '@/domain/services/source-engine/filter-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/domain/services/source-engine/source-language-syntax'
import { FILTER_DEFAULT_SOURCE } from '@/domain/services/source-engine/templates/filter.default.source'

export class FilterSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:filter'
  public readonly sourceKind: SourceKind = 'filter'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Filter Source',
    extension: '.endge-filter.ts',
    keywords: [
      'and', 'between', 'compact', 'defineFilter', 'field', 'inArray', 'inList',
      'output', 'relativeDate', 'relativeDateTime', 'row', 'value',
    ],
    functions: [
      'array', 'default', 'json', 'optional', 'options', 'predicate', 'vocab',
    ],
    properties: ['fields', 'label', 'labelPath', 'metadata', 'outputs', 'value', 'valuePath'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return FILTER_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileFilterSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Filter source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return FILTER_COMPLETIONS
  }
}

const FILTER_COMPLETIONS: SourceLanguageCompletion[] = [
  { label: 'defineFilter', kind: 'snippet', insertText: FILTER_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Filter source' },
  { label: 'metadata', kind: 'property', insertText: `metadata: {\n  'namespace.feature': {},\n},`, detail: 'Статическая metadata Filter' },
  { label: 'field', kind: 'function', insertText: `field('String').optional().default('')`, detail: 'Описание Filter field' },
  { label: 'options', kind: 'function', insertText: `.options([{ value: '', label: '' }])`, detail: 'Статические варианты поля' },
  { label: 'vocab', kind: 'function', insertText: `.vocab('', { valuePath: 'code', labelPath: 'name' })`, detail: 'Внешний vocab поля' },
  { label: 'output.json', kind: 'function', insertText: `output().json(({ value }) => compact({}))`, detail: 'JSON output' },
  { label: 'output.predicate', kind: 'function', insertText: `output().predicate(({ row, value }) => and())`, detail: 'Predicate output' },
  { label: 'relativeDate', kind: 'function', insertText: `relativeDate('-1d')`, detail: 'Относительная дата' },
  { label: 'relativeDateTime', kind: 'function', insertText: `relativeDateTime('-1d', 'startOfDay')`, detail: 'Относительная дата-время в UTC ISO' },
]
