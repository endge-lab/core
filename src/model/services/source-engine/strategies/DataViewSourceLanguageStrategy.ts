import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { compileDataViewSource } from '@/model/services/source-engine/compilers/data-view-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { resolveSourceDocumentReference } from '@/model/services/source-engine/source-document-reference'
import { DATA_VIEW_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/data-view.default.source'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/model/services/source-engine/value-expression-language'

/** Source language strategy для editor-facing операций RDataView source. */
export class DataViewSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:data-view'
  public readonly sourceKind: SourceKind = 'data-view'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge DataView Source',
    extension: '.endge-data-view.ts',
    keywords: [
      'auto', 'collectionByKey', 'convert', 'dataView', 'defineDataView', 'field',
      'from', 'full', 'incremental', 'join', 'map', 'output', 'path', 'pick', 'spread',
      'template', 'transform', ...VALUE_EXPRESSION_FUNCTION_NAMES,
    ],
    functions: ['as', 'auto', 'by', 'collectionByKey', 'convert', 'dataView', 'find', 'from', 'full', 'join', 'map', 'pick', ...VALUE_EXPRESSION_METHOD_NAMES],
    properties: ['incremental', 'input', 'left', 'manual', 'metadata', 'mode', 'output', 'pipeline', 'right', 'steps', 'tools'],
  })

  /** Проверяет, что strategy обслуживает DataView source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Возвращает базовый source новой RDataView. */
  public createDefaultSource(): string {
    return DATA_VIEW_DEFAULT_SOURCE
  }

  /** Валидирует DataView source через текущий compiler pass. */
  public validate(source: string): SourceLanguageValidationResult {
    const result = compileDataViewSource(source)
    const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ok,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'DataView source contains validation errors.',
    }
  }

  /** Возвращает подсказки v1 для разрешенного DataView source API. */
  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [...DATA_VIEW_SOURCE_COMPLETIONS, ...VALUE_EXPRESSION_COMPLETIONS]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveSourceDocumentReference(context, {
      functions: {
        dataView: 'data-view',
      },
      methods: {
        convert: 'converter',
      },
    })
  }
}

const DATA_VIEW_SOURCE_COMPLETIONS: SourceLanguageCompletion[] = [
  {
    label: 'defineDataView',
    kind: 'snippet',
    insertText: DATA_VIEW_DEFAULT_SOURCE.trimEnd(),
    detail: 'Создать DataView source',
  },
  {
    label: 'metadata',
    kind: 'property',
    insertText: `metadata: {
  'namespace.feature': {},
},`,
    detail: 'Статическая metadata DataView',
  },
  {
    label: 'manual.transform',
    kind: 'snippet',
    insertText: `defineDataView({
  mode: 'manual',

  transform(input, { convert }) {
    return input
  },
})`,
    detail: 'Manual transform function',
  },
  {
    label: 'pipeline.steps',
    kind: 'snippet',
    insertText: `defineDataView({
  mode: 'pipeline',

  steps: [
    from('items').as('item'),
    map({
      id: path('item.id'),
    }),
  ],
})`,
    detail: 'Pipeline transform steps',
  },
  { label: 'transform', kind: 'function', insertText: `transform(input, tools) {\n  return input\n}`, detail: 'Manual transform' },
  { label: 'steps', kind: 'property', insertText: `steps: [\n  from('items').as('item'),\n  map({})\n],`, detail: 'Pipeline steps' },
  { label: 'output', kind: 'property', insertText: `output: {\n  rows: path('items'),\n},`, detail: 'Object projection над целым input' },
  { label: 'incremental.auto', kind: 'property', insertText: 'incremental: auto(),', detail: 'Автоматический выбор full/byKey (default)' },
  { label: 'incremental.full', kind: 'property', insertText: 'incremental: full(),', detail: 'Всегда полный пересчет' },
  { label: 'incremental.collectionByKey', kind: 'property', insertText: `incremental: collectionByKey('id'),`, detail: 'Явный row-local incremental contract' },
  { label: 'from', kind: 'function', insertText: `from('items').as('item')`, detail: 'Берет input array' },
  { label: 'from.dataView', kind: 'function', insertText: `from('items').dataView(dataView('normalize')).as('item')`, detail: 'Применяет DataView перед map' },
  { label: 'dataView', kind: 'function', insertText: `dataView('data-view-identity')`, detail: 'Ссылка на доменный DataView' },
  { label: 'join', kind: 'function', insertText: `join('attrs').by({ left: 'item.id', right: 'itemId', as: 'attrs' })`, detail: 'Связка по ключам' },
  { label: 'map', kind: 'function', insertText: `map({\n  id: path('item.id'),\n})`, detail: 'Формирует output row' },
  { label: 'spread', kind: 'function', insertText: `...spread('item')`, detail: 'Копирует объект в output row перед переопределениями' },
  { label: 'path', kind: 'function', insertText: `path('item.id')`, detail: 'Читает путь из scope' },
  { label: 'template', kind: 'function', insertText: `template('{item.code}/{item.number}')`, detail: 'String template из scope' },
  { label: 'convert', kind: 'function', insertText: `.convert('date.iso_to_time', { format: 'HH:mm' })`, detail: 'Применяет converter' },
  { label: 'field', kind: 'function', insertText: `field('String')`, detail: 'Будущий contract helper' },
]
