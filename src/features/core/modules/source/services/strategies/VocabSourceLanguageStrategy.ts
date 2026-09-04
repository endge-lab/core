import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileVocabSource } from '@/features/core/modules/source/services/compilers/vocab-source-compile'
import { resolveSourceDocumentReference } from '@/features/core/modules/source/services/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import { VOCAB_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/vocab.default.source'

const VOCAB_SOURCE_COMPLETIONS: SourceLanguageCompletion[] = [
  {
    label: 'defineVocab',
    kind: 'snippet',
    insertText: VOCAB_DEFAULT_SOURCE.trimEnd(),
    detail: 'Создать Vocab source',
  },
  {
    label: 'payload provider',
    kind: 'property',
    insertText: `provider: payload({\n  baseUrl: env('ENDPOINT_VOCABS_SERVICE'),\n  collection: '',\n  auth: { mode: 'inherit' },\n}),`,
    detail: 'Payload provider словаря',
  },
  {
    label: 'mock',
    kind: 'property',
    insertText: `mock: mock('fixtures').path('lookups.items'),`,
    detail: 'Mock JSON document и dot-path',
  },
  {
    label: 'convert',
    kind: 'function',
    insertText: `.convert('converter-identity')`,
    detail: 'Преобразовать текущее значение целиком',
  },
]

export class VocabSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:vocab'
  public readonly sourceKind: SourceKind = 'vocab'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Vocab Source',
    extension: '.endge-vocab.ts',
    keywords: ['defineVocab', 'payload', 'env', 'mock', 'output', 'response', 'converter', 'dataView'],
    functions: ['defineVocab', 'payload', 'env', 'mock', 'path', 'output', 'from', 'response', 'dataView', 'convert', 'converter'],
    properties: ['provider', 'baseUrl', 'collection', 'auth', 'mode', 'profile', 'mock', 'outputs', 'items'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return VOCAB_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileVocabSource(source)
    const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Vocab source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return VOCAB_SOURCE_COMPLETIONS
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveSourceDocumentReference(context, {
      functions: { mock: 'mock', dataView: 'data-view', converter: 'converter' },
      methods: { dataView: 'data-view', convert: 'converter' },
      properties: [{ property: 'profile', parentProperty: 'auth', target: 'auth-profile' }],
    })
  }
}
