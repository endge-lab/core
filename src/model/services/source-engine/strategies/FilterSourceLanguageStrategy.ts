import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { compileFilterSource } from '@/model/services/source-engine/compilers/filter-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { resolveSourceDocumentReference } from '@/model/services/source-engine/source-document-reference'
import { FILTER_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/filter.default.source'
import { validateTypeExpressionUsage } from '@/model/services/compiler/type/type-program-validation'

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

  public validate(source: string, context?: SourceLanguageContext): SourceLanguageValidationResult {
    const result = compileFilterSource(source)
    const typeDiagnostics = context?.typeSymbols
      ? (result.artifact?.fields.flatMap(field => validateTypeExpressionUsage(
          field.type,
          context.typeSymbols!.map((type, index) => ({
            id: index,
            identity: type.identity,
            displayName: type.displayName ?? type.identity,
            category: type.category ?? 'user',
            sourceVersion: 1,
            definition: null,
            status: 'valid',
          })),
          `fields.${field.key}.type`,
        )) ?? [])
      : []
    const diagnostics = [...result.diagnostics, ...typeDiagnostics]
    const ok = !diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics, message: ok ? undefined : 'Filter source contains validation errors.' }
  }

  public completions(context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      ...FILTER_COMPLETIONS,
      ...(context.typeSymbols ?? []).map(type => ({
        label: type.identity,
        kind: 'value' as const,
        insertText: type.identity,
        detail: `${type.category ?? 'user'} type`,
        documentation: type.displayName,
      })),
    ]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveSourceDocumentReference(context, {
      functions: {
        field: 'type',
      },
      methods: {
        vocab: 'vocabs',
      },
    })
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
