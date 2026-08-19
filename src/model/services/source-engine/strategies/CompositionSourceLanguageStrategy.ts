import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { compileCompositionSource } from '@/model/services/source-engine/compilers/composition-source-compile'
import {
  compositionSourceI18nHints,
  compositionSourceI18nReferenceAt,
} from '@/model/services/source-engine/composition-source-i18n-hints'
import { normalizeCompositionSourceTypeReferences } from '@/model/services/source-engine/composition-source-normalize'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { resolveTypedSourceDocumentReference, typedSourceTypeReferenceHighlights } from '@/model/services/source-engine/source-document-reference'
import { COMPOSITION_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/composition.default.source'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/model/services/source-engine/value-expression-language'

export class CompositionSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:composition'
  public readonly sourceKind: SourceKind = 'composition'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Composition Source',
    extension: '.endge-composition.ts',
    keywords: [
      'component', 'composition', 'control', 'data', 'dataView', 'defineComposition', 'definePreviewProps', 'defineProps', 'filter', 'filterView', 'fromData', 'fromFilter', 'fromOutput', 'fromStore', 'manual', 'mock', 'onChange',
      'onMount', 'onSuccess', 'onEvent', 'event', 'action', 'update', 'output', 'policy', 'query', 'metadata', 'resources', 'scope', 'startup', 'stream', 'style', 'vocab', ...VALUE_EXPRESSION_FUNCTION_NAMES,
    ],
    functions: [
      'activateOn', 'applyUpdate', 'batch', 'component', 'contextual', 'controls', 'dataView', 'debounce', 'dispatchTo', 'executeAction', 'fields', 'fromRuntime', 'fromScope', 'injected', 'isolated', 'mutate', 'persist', 'policy', 'run', 'select', 'slot', 'store', 'storeTo', 'vocab', 'withData', 'withProps', ...VALUE_EXPRESSION_METHOD_NAMES,
    ],
    properties: ['activateOn', 'data', 'dataMode', 'hooks', 'key', 'metadata', 'outputs', 'previewProps', 'props', 'resources', 'runtimes'],
  })

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return COMPOSITION_DEFAULT_SOURCE
  }

  public normalize(source: string): string {
    return normalizeCompositionSourceTypeReferences(source)
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileCompositionSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Composition source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [...COMPOSITION_COMPLETIONS, ...VALUE_EXPRESSION_COMPLETIONS]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveTypedSourceDocumentReference(context, {
      functions: {
        component: 'component',
        composition: 'composition',
        filter: 'filter',
        filterView: 'filter',
        i18n: 'i18n-bundles',
        mock: 'mock',
        query: 'query',
        stream: 'stream',
        store: 'store',
        style: 'style',
        vocab: 'vocabs',
      },
      methods: {
        component: 'component',
        dataView: 'data-view',
      },
    }) ?? compositionSourceI18nReferenceAt(context)
  }

  public semanticHighlights(context: SourceLanguageContext) {
    return typedSourceTypeReferenceHighlights(context)
  }

  public inlineHints(context: SourceLanguageContext) {
    return compositionSourceI18nHints(context)
  }
}

const COMPOSITION_COMPLETIONS: SourceLanguageCompletion[] = [
  { label: 'defineComposition', kind: 'snippet', insertText: COMPOSITION_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Composition source' },
  { label: 'metadata', kind: 'property', insertText: `metadata: {\n  'namespace.feature': {},\n},`, detail: 'Статическая metadata Composition' },
  { label: 'dataMode', kind: 'property', insertText: `dataMode: 'mock',`, detail: 'Override runtime data mode for this Composition subtree' },
  { label: 'props', kind: 'property', insertText: `props: defineProps({\n  value: field('Object'),\n}),`, detail: 'Typed public Composition props' },
  { label: 'previewProps', kind: 'property', insertText: `previewProps: definePreviewProps({\n  propName: {},\n}),`, detail: 'Preview-only props: static JSON values or mock(identity)' },
  { label: 'mock', kind: 'function', insertText: `mock('identity')`, detail: 'RMock value for one preview prop' },
  { label: 'filter', kind: 'function', insertText: `filter('identity')`, detail: 'Filter runtime' },
  { label: 'store', kind: 'function', insertText: `store('identity')`, detail: 'Contextual Store data: nearest provider or local fallback' },
  { label: 'vocab', kind: 'function', insertText: `vocab('identity')`, detail: 'Shared Vocab data loaded into Raph on scope activation' },
  { label: 'policy', kind: 'function', insertText: `.policy({
  strategy: 'cache-first',
  maxAgeMs: null,
  onError: 'fail',
})`, detail: 'Vocab cache and loading policy' },
  { label: 'isolated', kind: 'function', insertText: `.isolated()`, detail: 'Always create a local Store instance' },
  { label: 'injected', kind: 'function', insertText: `.injected()`, detail: 'Require an ancestor or explicit Store provider' },
  { label: 'slot', kind: 'function', insertText: `.slot('name')`, detail: 'Select a named Store provider slot' },
  { label: 'fromData', kind: 'function', insertText: `fromData('store.field')`, detail: 'Composition data binding' },
  { label: 'fromData.dataView', kind: 'function', insertText: `fromData('store.field').dataView('data-view-identity', {
  search: fromOutput('filter', 'search'),
})`, detail: 'Parameterized materialized DataView binding' },
  { label: 'storeTo', kind: 'function', insertText: `.storeTo(data('store'), {
  raw: output('raw'),
})`, detail: 'Atomic Query output publication to Store data' },
  { label: 'filterView', kind: 'function', insertText: `filterView('filter')`, detail: 'Renderable Filter view runtime' },
  { label: 'query', kind: 'function', insertText: `query('identity').withProps({})`, detail: 'Query runtime' },
  { label: 'stream', kind: 'function', insertText: `stream('identity').batch({ maxItems: 50, maxWaitMs: 16 }).dispatchTo(data('firstStore'), data('secondStore'))`, detail: 'Stream runtime routed to Store updates' },
  { label: 'batch', kind: 'function', insertText: `.batch({ maxItems: 50, maxWaitMs: 16 })`, detail: 'Composition-owned Stream batching' },
  { label: 'dispatchTo', kind: 'function', insertText: `.dispatchTo(data('store'))`, detail: 'Dispatch Stream or Component events to Store update handlers' },
  { label: 'onEvent', kind: 'function', insertText: `onEvent('componentRuntime', 'edited').applyUpdate(data('store'), update('update-identity'))`, detail: 'Route one Component Event explicitly' },
  { label: 'component', kind: 'function', insertText: `component('identity').withProps({})`, detail: 'Component runtime' },
  { label: 'composition', kind: 'function', insertText: `composition('identity')`, detail: 'Nested Composition runtime' },
  { label: 'withData', kind: 'function', insertText: `.withData({
  childAlias: data('parentAlias'),
})`, detail: 'Explicit Store data binding for nested Composition' },
  { label: 'scope', kind: 'function', insertText: `scope({\n  data: {},\n  resources: {},\n  runtimes: {},\n}).activateOn(manual())`, detail: 'Data/resource/runtime lifecycle scope' },
  { label: 'style', kind: 'function', insertText: `style('style-identity')`, detail: 'Owned EndgeCSS resource' },
  { label: 'activateOn', kind: 'function', insertText: `.activateOn(startup())`, detail: 'Instance activation override' },
  { label: 'fromScope', kind: 'function', insertText: `output().fromScope('scope.path')`, detail: 'Public RuntimeScope handle' },
  { label: 'fromOutput', kind: 'function', insertText: `fromOutput('runtime')`, detail: 'All runtime outputs; pass a second argument to select one output' },
  { label: 'metadataOf', kind: 'function', insertText: `metadataOf('runtime')`, detail: 'All runtime metadata; pass a second argument to select one namespace' },
  { label: 'fromFilter', kind: 'function', insertText: `fromFilter('filter').fields([])`, detail: 'Filter fields runtime slice binding' },
  { label: 'fromStore', kind: 'function', insertText: `fromStore('path')`, detail: 'Raph store binding' },
  { label: 'onChange', kind: 'function', insertText: `onChange('runtime.output').debounce(200).run('query')`, detail: 'Run Query after a runtime output or public prop changes' },
  { label: 'onSuccess', kind: 'function', insertText: `onSuccess('query').run('dependent-query')`, detail: 'Run after Query succeeds' },
]
