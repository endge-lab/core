import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source-engine.types'

import { compileCompositionSource } from '@/domain/services/source-engine/composition-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/domain/services/source-engine/source-language-syntax'
import { COMPOSITION_DEFAULT_SOURCE } from '@/domain/services/source-engine/templates/composition.default.source'

export class CompositionSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:composition'
  public readonly sourceKind: SourceKind = 'composition'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Composition Source',
    extension: '.endge-composition.ts',
    keywords: [
      'component', 'defineComposition', 'filter', 'filterFields', 'fromFilter', 'fromOutput', 'fromStore', 'onChange',
      'onMount', 'output', 'query',
    ],
    functions: [
      'debounce', 'fields', 'fromRuntime', 'instance', 'persist', 'run', 'select', 'withProps',
    ],
    properties: ['hooks', 'key', 'outputs', 'runtimes'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return COMPOSITION_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileCompositionSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Composition source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return COMPOSITION_COMPLETIONS
  }
}

const COMPOSITION_COMPLETIONS: SourceLanguageCompletion[] = [
  { label: 'defineComposition', kind: 'snippet', insertText: COMPOSITION_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Composition source' },
  { label: 'filter', kind: 'function', insertText: `filter('identity').instance('default')`, detail: 'Filter runtime' },
  { label: 'filterFields', kind: 'function', insertText: `filterFields('filter').fields([])`, detail: 'Renderable Filter fields runtime slice' },
  { label: 'query', kind: 'function', insertText: `query('identity').withProps({})`, detail: 'Query runtime' },
  { label: 'component', kind: 'function', insertText: `component('identity').withProps({})`, detail: 'Component runtime' },
  { label: 'fromOutput', kind: 'function', insertText: `fromOutput('runtime', 'output')`, detail: 'Runtime output binding' },
  { label: 'fromFilter', kind: 'function', insertText: `fromFilter('filter').fields([])`, detail: 'Filter fields runtime slice binding' },
  { label: 'fromStore', kind: 'function', insertText: `fromStore('path')`, detail: 'Raph store binding' },
  { label: 'onChange', kind: 'function', insertText: `onChange('runtime.output').debounce(200).run('query')`, detail: 'Debounced hook' },
]
