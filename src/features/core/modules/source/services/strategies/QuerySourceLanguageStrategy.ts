import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageSyntaxDefinition,
  SourceLanguageValidationResult,
} from '@/features/core/modules/source/domain/types/source-engine.types'

import { validateTypeExpressionUsage, validateTypeSourceExpressionUsage } from '@/features/core/modules/compiler/services/type/type-program-validation'
import { compileQuerySource } from '@/features/core/modules/source/services/compilers/query-source-compile'
import { resolveTypedSourceDocumentReference, typedSourceTypeReferenceHighlights } from '@/features/core/modules/source/services/source-document-reference'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/features/core/modules/source/services/value-expression-language'
import { QUERY_DEFAULT_SOURCE, QUERY_GRAPHQL_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/query.default.source'

const QUERY_SOURCE_COMPLETIONS: SourceLanguageCompletion[] = [
  {
    label: 'defineQuery',
    kind: 'snippet',
    insertText: QUERY_DEFAULT_SOURCE.trimEnd(),
    detail: 'Создать REST query source',
    documentation: 'Минимальный валидный source для RQuery v2.',
  },
  {
    label: 'defineGraphQLQuery',
    kind: 'snippet',
    insertText: QUERY_GRAPHQL_DEFAULT_SOURCE.trimEnd(),
    detail: 'Создать GraphQL query source',
    documentation: 'GraphQL document, variables и data outputs в source RQuery v2.',
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
    label: 'request.graphql',
    kind: 'property',
    insertText: `request: {
  endpoint: '',
  operationName: 'OperationName',
  document: gql\`
    query OperationName {
      items {
        id
      }
    }
  \`,
  variables: variables(() => ({})),
  headers: {},
  auth: { mode: 'inherit' },
  errorPolicy: 'throw',
},`,
    detail: 'GraphQL operation config',
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
    label: 'output.contract',
    kind: 'function',
    insertText: `.contract(field(TypeIdentity).array())`,
    detail: 'Тип результата Query output',
  },
  {
    label: 'response',
    kind: 'function',
    insertText: `response('items')`,
    detail: 'Selector backend response',
  },
  {
    label: 'data',
    kind: 'function',
    insertText: `data('items')`,
    detail: 'Selector GraphQL data',
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
    label: 'field.object',
    kind: 'snippet',
    insertText: `field(objectOf({
  property: field(String),
}))`,
    detail: 'Вложенный объектный Query prop',
  },
  {
    label: 'field.record',
    kind: 'snippet',
    insertText: `field(recordOf(objectOf({
  property: field(String),
})))`,
    detail: 'Query prop с произвольными string-ключами',
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

/** Source language strategy для editor-facing операций RQuery source. */
export class QuerySourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:query'
  public readonly sourceKind: SourceKind = 'query'
  public readonly syntax = withGraphQLSyntax(createTypeScriptLikeSourceSyntax({
    alias: 'Endge Query Source',
    extension: '.endge-query.ts',
    keywords: [
      'auto',
      'body',
      'collectionByKey',
      'compact',
      'contract',
      'converter',
      'data',
      'dataView',
      'defineDataView',
      'defineFilter',
      'defineProps',
      'defineQuery',
      'endgeVar',
      'env',
      'field',
      'filter',
      'full',
      'gql',
      'graphql',
      'ignore',
      'incremental',
      'merge',
      'objectOf',
      'output',
      'prop',
      'recordOf',
      'response',
      'throw',
      'variables',
      ...VALUE_EXPRESSION_FUNCTION_NAMES,
    ],
    functions: [
      'array',
      'as',
      'auto',
      'by',
      'collectionByKey',
      'contract',
      'converter',
      'dataView',
      'default',
      'from',
      'full',
      'map',
      'optional',
      'options',
      'vocab',
      ...VALUE_EXPRESSION_METHOD_NAMES,
    ],
    properties: [
      'auth',
      'body',
      'data',
      'document',
      'enabled',
      'endpoint',
      'errorPolicy',
      'formUrlencoded',
      'headers',
      'incremental',
      'items',
      'kind',
      'method',
      'mock',
      'mode',
      'outputs',
      'path',
      'metadata',
      'operationName',
      'profile',
      'props',
      'request',
      'timeoutMs',
      'variables',
    ],
  }))

  /** Проверяет, что стратегия обслуживает query source. */
  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  /** Возвращает базовый source новой RQuery. */
  public createDefaultSource(variant?: string): string {
    return variant === 'graphql' || variant === 'query-gql'
      ? QUERY_GRAPHQL_DEFAULT_SOURCE
      : QUERY_DEFAULT_SOURCE
  }

  /** Валидирует query source через текущий compiler pass. */
  public validate(source: string, context?: SourceLanguageContext): SourceLanguageValidationResult {
    const result = compileQuerySource(source)
    const typeCatalog = context?.typeSymbols?.map((type, index) => ({
      id: index,
      identity: type.identity,
      displayName: type.displayName ?? type.identity,
      category: type.category ?? 'user',
      sourceVersion: 1,
      definition: null,
      status: 'valid',
    } as const))
    const typeDiagnostics = typeCatalog
      ? [
          ...(result.artifact?.props.flatMap(prop => [
            ...validateTypeExpressionUsage(prop.type, typeCatalog, `props.${prop.key}.type`),
            ...validateTypeSourceExpressionUsage(prop.typeExpression, typeCatalog, `props.${prop.key}.typeExpression`),
          ]) ?? []),
          ...(result.artifact?.outputs.flatMap(output => [
            ...validateTypeExpressionUsage(output.contract?.type, typeCatalog, `outputs.${output.key}.contract.type`),
            ...validateTypeSourceExpressionUsage(output.contract?.typeExpression, typeCatalog, `outputs.${output.key}.contract.typeExpression`),
          ]) ?? []),
        ]
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
    return resolveTypedSourceDocumentReference(context, {
      functions: {
        converter: 'converter',
        dataView: 'data-view',
        filter: 'filter',
      },
      methods: {
        convert: 'converter',
        dataView: 'data-view',
      },
      properties: [{ property: 'profile', parentProperty: 'auth', target: 'auth-profile' }],
    })
  }

  public semanticHighlights(context: SourceLanguageContext) {
    return typedSourceTypeReferenceHighlights(context)
  }
}

/** Добавляет токенизацию GraphQL только внутри статических tagged templates gql. */
function withGraphQLSyntax(syntax: SourceLanguageSyntaxDefinition): SourceLanguageSyntaxDefinition {
  return {
    ...syntax,
    tokenizer: {
      ...syntax.tokenizer,
      root: [
        { pattern: /\bgql\s*`/, token: 'keyword', next: '@graphql' },
        ...syntax.tokenizer.root,
      ],
      graphql: [
        { pattern: /`/, token: 'string', next: '@pop' },
        { pattern: /#.*$/, token: 'comment' },
        { pattern: /"""/, token: 'string', next: '@graphqlBlockString' },
        { pattern: /"/, token: 'string', next: '@graphqlString' },
        { pattern: /\.\.\./, token: 'keyword' },
        { pattern: /\$(?!\d)\w+/, token: 'variable' },
        { pattern: /@(?!\d)\w+/, token: 'keyword' },
        { pattern: /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:(?:e|E)[+-]?\d+)?/, token: 'number' },
        {
          pattern: /\b(?:query|mutation|subscription|fragment|on|schema|scalar|type|interface|implements|enum|union|input|directive|extend|repeatable|true|false|null)\b/,
          token: 'keyword',
        },
        { pattern: /(?!\d)\w+/, token: 'type.identifier' },
        { pattern: /[!():=[\]{|}&,]/, token: 'delimiter' },
      ],
      graphqlString: [
        { pattern: /[^"\\]+/, token: 'string' },
        { pattern: /\\(?:["\\/bfnrt]|u[\da-fA-F]{4})/, token: 'string.escape' },
        { pattern: /"/, token: 'string', next: '@pop' },
        { pattern: /\\./, token: 'string.invalid' },
      ],
      graphqlBlockString: [
        { pattern: /[^"\\]+/, token: 'string' },
        { pattern: /\\"""/, token: 'string.escape' },
        { pattern: /"""/, token: 'string', next: '@pop' },
        { pattern: /["\\]/, token: 'string' },
      ],
    },
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
