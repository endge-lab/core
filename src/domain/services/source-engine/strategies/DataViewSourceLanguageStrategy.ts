import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source-engine.types'

import { compileDataViewSource } from '@/domain/services/source-engine/data-view-source-compile'
import { DATA_VIEW_DEFAULT_SOURCE } from '@/domain/services/source-engine/templates/data-view.default.source'

/** Source language strategy для editor-facing операций RDataView source. */
export class DataViewSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:data-view'
  public readonly sourceKind: SourceKind = 'data-view'

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
    return DATA_VIEW_SOURCE_COMPLETIONS
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
  { label: 'from', kind: 'function', insertText: `from('items').as('item')`, detail: 'Берет input array' },
  { label: 'join', kind: 'function', insertText: `join('attrs').by({ left: 'item.id', right: 'itemId', as: 'attrs' })`, detail: 'Связка по ключам' },
  { label: 'map', kind: 'function', insertText: `map({\n  id: path('item.id'),\n})`, detail: 'Формирует output row' },
  { label: 'spread', kind: 'function', insertText: `...spread('item')`, detail: 'Копирует объект в output row перед переопределениями' },
  { label: 'path', kind: 'function', insertText: `path('item.id')`, detail: 'Читает путь из scope' },
  { label: 'template', kind: 'function', insertText: `template('{item.code}/{item.number}')`, detail: 'String template из scope' },
  { label: 'convert', kind: 'function', insertText: `.convert('date.iso_to_time', { format: 'HH:mm' })`, detail: 'Применяет converter' },
  { label: 'field', kind: 'function', insertText: `field('String')`, detail: 'Будущий contract helper' },
]
