import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { compileQuerySource } from '@/model/services/source-engine/compilers/query-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { resolveSourceDocumentReference } from '@/model/services/source-engine/source-document-reference'
import { QUERY_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/query.default.source'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/model/services/source-engine/value-expression-language'
import { validateTypeExpressionUsage } from '@/model/services/compiler/type/type-program-validation'

/** Source language strategy для editor-facing операций RQuery source. */
export class QuerySourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:query'
  public readonly sourceKind: SourceKind = 'query'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Query Source',
    extension: '.endge-query.ts',
    keywords: [
      'auto', 'body', 'collectionByKey', 'compact', 'converter', 'dataView', 'defineDataView', 'defineFilter', 'defineProps',
      'defineQuery', 'endgeVar', 'env', 'field', 'filter', 'merge', 'output', 'prop',
      'full', 'incremental', 'response', ...VALUE_EXPRESSION_FUNCTION_NAMES,
    ],
    functions: [
      'array', 'as', 'auto', 'by', 'collectionByKey', 'converter', 'dataView', 'default', 'from', 'full', 'map', 'optional',
      'options', 'vocab', ...VALUE_EXPRESSION_METHOD_NAMES,
    ],
    properties: [
      'auth', 'body', 'data', 'enabled', 'endpoint', 'formUrlencoded',
      'headers', 'incremental', 'items', 'kind', 'method', 'mock', 'mode', 'outputs', 'path',
      'metadata', 'props', 'request', 'timeoutMs',
    ],
  })

  /** Проверяет, что стратегия обслуживает query source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Возвращает базовый source новой RQuery. */
  public createDefaultSource(): string {
    return QUERY_DEFAULT_SOURCE
  }

  /** Валидирует query source через текущий compiler pass. */
  public validate(source: string, context?: SourceLanguageContext): SourceLanguageValidationResult {
    const result = compileQuerySource(source)
    const typeDiagnostics = context?.typeSymbols
      ? (result.artifact?.props.flatMap(prop => validateTypeExpressionUsage(
          prop.type,
          context.typeSymbols!.map((type, index) => ({
            id: index,
            identity: type.identity,
            displayName: type.displayName ?? type.identity,
            category: type.category ?? 'user',
            sourceVersion: 1,
            definition: null,
            status: 'valid',
          })),
          `props.${prop.key}.type`,
        )) ?? [])
      : []
    const diagnostics = [...result.diagnostics, ...typeDiagnostics]
    const ok = !diagnostics.some(diagnostic => diagnostic.severity === 'error')

    return {
      ok,
      diagnostics,
      message: ok ? undefined : 'Query source contains validation errors.',
    }
  }

  /** Возвращает подсказки source-only Query v2 API. */
  public completions(context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [...QUERY_SOURCE_COMPLETIONS, ...VALUE_EXPRESSION_COMPLETIONS, ...typeCompletions(context)]
  }

  public resolveReference(context: SourceLanguageContext) {
    return resolveSourceDocumentReference(context, {
      functions: {
        converter: 'converter',
        dataView: 'data-view',
        field: 'type',
        filter: 'filter',
      },
      methods: {
        convert: 'converter',
        dataView: 'data-view',
      },
      properties: [{ property: 'profile', parentProperty: 'auth', target: 'auth-profile' }],
    })
  }
}

function typeCompletions(context: SourceLanguageContext): SourceLanguageCompletion[] {
  return (context.typeSymbols ?? []).map(type => ({
    label: type.identity,
    kind: 'value',
    insertText: type.identity,
    detail: `${type.category ?? 'user'} type`,
    documentation: type.displayName,
  }))
}

const QUERY_SOURCE_COMPLETIONS: SourceLanguageCompletion[] = [
  {
    label: 'defineQuery',
    kind: 'snippet',
    insertText: QUERY_DEFAULT_SOURCE.trimEnd(),
    detail: 'Создать REST query source',
    documentation: 'Минимальный валидный source для RQuery v2.',
  },
  {
    label: 'metadata',
    kind: 'property',
    insertText: `metadata: {
  'namespace.feature': {},
},`,
    detail: 'Статическая metadata Query',
  },
  {
    label: 'defineProps',
    kind: 'property',
    insertText: `props: defineProps({
  filterPayload: field('Object').optional(),
}),`,
    detail: 'Query v2 props contract',
  },
  {
    label: 'request.body',
    kind: 'property',
    insertText: `body: body(({ prop }) =>
  merge({}, prop('filterPayload')),
),`,
    detail: 'Static request body IR',
  },
  {
    label: 'field.from.filter',
    kind: 'function',
    insertText: `.from(filter('filter-identity').output('request'))`,
    detail: 'Default Filter output for standalone Query',
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
    mode: 'inherit',
  },
},`,
    detail: 'HTTP request config',
  },
  {
    label: 'outputs',
    kind: 'property',
    insertText: `outputs: {
  raw: output()
    .from(response('items')),
},`,
    detail: 'Query output graph',
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
    label: 'output',
    kind: 'function',
    insertText: `output().from(response('items'))`,
    detail: 'Описывает output из response или предыдущего output',
  },
  {
    label: 'response',
    kind: 'function',
    insertText: `response('items')`,
    detail: 'Selector backend response',
  },
  {
    label: 'dataView',
    kind: 'function',
    insertText: `.dataView('data-view-identity')`,
    detail: 'Ссылка на доменный DataView',
  },
  {
    label: 'defineDataView',
    kind: 'snippet',
    insertText: `defineDataView({
  mode: 'pipeline',
  steps: [
    from('').as('row'),
    map({
      ...spread('row'),
    }),
  ],
})`,
    detail: 'Локальный pipeline DataView',
  },
  {
    label: 'field',
    kind: 'function',
    insertText: `field('String')`,
    detail: 'Описание поля',
    documentation: 'Поддерживает chain API: field(...).array().optional().default(...).from(...).',
  },
  {
    label: 'filter',
    kind: 'function',
    insertText: `filter('filter-identity')`,
    detail: 'Ссылка на доменный фильтр',
  },
  {
    label: 'env',
    kind: 'function',
    insertText: `env('API_BASE_URL')`,
    detail: 'Ссылка на environment variable',
  },
  {
    label: 'auth.profile',
    kind: 'value',
    insertText: `auth: {
  mode: 'profile',
  profile: 'auth-profile-identity',
},`,
    detail: 'Auth profile config',
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
