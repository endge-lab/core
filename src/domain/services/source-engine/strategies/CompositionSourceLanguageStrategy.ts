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
      'component', 'control', 'data', 'defineComposition', 'filter', 'filterView', 'fromData', 'fromFilter', 'fromOutput', 'fromStore', 'onChange',
      'onMount', 'output', 'query',
    ],
    functions: [
      'component', 'controls', 'debounce', 'fields', 'fromRuntime', 'persist', 'run', 'select', 'store', 'storeTo', 'vocab', 'withProps',
    ],
    properties: ['data', 'hooks', 'key', 'outputs', 'runtimes'],
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
  { label: 'filter', kind: 'function', insertText: `filter('identity')`, detail: 'Filter runtime' },
  { label: 'store', kind: 'function', insertText: `store('identity')`, detail: 'Store data dependency' },
  { label: 'fromData', kind: 'function', insertText: `fromData('store.field')`, detail: 'Composition data binding' },
  { label: 'storeTo', kind: 'function', insertText: `.storeTo(data('store'), {
  raw: output('raw'),
})`, detail: 'Atomic Query output publication to Store data' },
  { label: 'filterView', kind: 'function', insertText: `filterView('filter')`, detail: 'Renderable Filter view runtime' },
  { label: 'query', kind: 'function', insertText: `query('identity').withProps({})`, detail: 'Query runtime' },
  { label: 'component', kind: 'function', insertText: `component('identity').withProps({})`, detail: 'Component runtime' },
  { label: 'fromOutput', kind: 'function', insertText: `fromOutput('runtime', 'output')`, detail: 'Runtime output binding' },
  { label: 'fromFilter', kind: 'function', insertText: `fromFilter('filter').fields([])`, detail: 'Filter fields runtime slice binding' },
  { label: 'fromStore', kind: 'function', insertText: `fromStore('path')`, detail: 'Raph store binding' },
  { label: 'onChange', kind: 'function', insertText: `onChange('runtime.output').debounce(200).run('query')`, detail: 'Debounced hook' },
]
