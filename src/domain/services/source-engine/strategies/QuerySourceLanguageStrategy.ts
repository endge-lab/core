import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source-engine.types'

import { compileQuerySource } from '@/domain/services/source-engine/query-source-compile'
import { QUERY_DEFAULT_SOURCE } from '@/domain/services/source-engine/templates/query.default.source'

/** Source language strategy для editor-facing операций RQuery source. */
export class QuerySourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:query'
  public readonly sourceKind: SourceKind = 'query'

  /** Проверяет, что стратегия обслуживает query source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Возвращает базовый source новой RQuery. */
  public createDefaultSource(): string {
    return QUERY_DEFAULT_SOURCE
  }

  /** Валидирует query source через текущий compiler pass. */
  public validate(source: string): SourceLanguageValidationResult {
    const result = compileQuerySource(source)
    const ok = !result.diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ok,
      diagnostics: result.diagnostics,
      message: ok ? undefined : 'Query source contains validation errors.',
    }
  }

  /** Возвращает подсказки v1 для разрешенного query source API. */
  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return QUERY_SOURCE_COMPLETIONS
  }
}

const QUERY_SOURCE_COMPLETIONS: SourceLanguageCompletion[] = [
  {
    label: 'defineQuery',
    kind: 'snippet',
    insertText: QUERY_DEFAULT_SOURCE.trimEnd(),
    detail: 'Создать REST query source',
    documentation: 'Минимальный валидный source для RQuery v1.',
  },
  {
    label: 'request',
    kind: 'property',
    insertText: `request: {
  endpoint: '',
  path: '',
  method: 'GET',
  headers: {},
  auth: {
    mode: 'token',
  },
},`,
    detail: 'HTTP request config',
  },
  {
    label: 'params',
    kind: 'property',
    insertText: `params: {
  name: field('String'),
},`,
    detail: 'Query params schema',
  },
  {
    label: 'response',
    kind: 'property',
    insertText: `response: {
  subField: 'items',
  return: null,
},`,
    detail: 'Response mapping',
  },
  {
    label: 'filters',
    kind: 'property',
    insertText: `filters: {
  mode: 'merge',
  items: [],
},`,
    detail: 'Query filters',
  },
  {
    label: 'mock',
    kind: 'property',
    insertText: `mock: {
  enabled: false,
  data: null,
},`,
    detail: 'Mock data config',
  },
  {
    label: 'field',
    kind: 'function',
    insertText: `field('String')`,
    detail: 'Описание поля',
    documentation: 'Поддерживает chain API: field(...).array().optional().params({...}).',
  },
  {
    label: 'filter.inline',
    kind: 'function',
    insertText: `filter.inline({})`,
    detail: 'Inline filter object',
  },
  {
    label: 'filter.reference',
    kind: 'function',
    insertText: `filter.reference('filter-identity')`,
    detail: 'Ссылка на доменный фильтр',
  },
  {
    label: 'env',
    kind: 'function',
    insertText: `env('API_BASE_URL')`,
    detail: 'Ссылка на environment variable',
  },
  {
    label: 'auth.token',
    kind: 'value',
    insertText: `auth: {
  mode: 'token',
},`,
    detail: 'Token auth config',
  },
  {
    label: 'method.GET',
    kind: 'value',
    insertText: `'GET'`,
    detail: 'HTTP GET',
  },
  {
    label: 'method.POST',
    kind: 'value',
    insertText: `'POST'`,
    detail: 'HTTP POST',
  },
]
