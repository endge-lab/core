import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import { SOURCE_CONTEXT_COMPLETIONS, SOURCE_CONTEXT_FUNCTION_NAMES } from '@/features/core/modules/source/services/value-expression-language'
import { STREAM_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/stream.default.source'

export class StreamSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:stream'
  public readonly sourceKind: SourceKind = 'stream'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Stream Source',
    extension: '.endge-stream.ts',
    keywords: ['defineStream', 'sse', 'websocket', 'graphqlSse', 'event', 'env', 'defineProps', 'field', 'gql', 'variables', 'prop', 'subscription', 'next', 'complete', 'POST', 'GET', 'throw', 'ignore', 'all', ...SOURCE_CONTEXT_FUNCTION_NAMES],
    functions: ['defineStream', 'sse', 'websocket', 'graphqlSse', 'event', 'env', 'defineProps', 'field', 'gql', 'variables', 'prop', ...SOURCE_CONTEXT_FUNCTION_NAMES],
    properties: ['props', 'transport', 'events', 'url', 'withCredentials', 'auth', 'mode', 'profile', 'type', 'typeFrom', 'payloadFrom', 'onOpen', 'match', 'eachFrom', 'method', 'document', 'fragments', 'operationName', 'variables', 'headers', 'extensions', 'errorPolicy', 'reconnectDelay', 'next', 'complete'],
  })

  public supports(sourceKind: SourceKind | string): boolean { return sourceKind === this.sourceKind }
  public createDefaultSource(): string { return STREAM_DEFAULT_SOURCE }
  public validate(source: string): SourceLanguageValidationResult {
    const result = compileStreamSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Stream source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      ...SOURCE_CONTEXT_COMPLETIONS,
      { label: 'defineStream', kind: 'snippet', insertText: STREAM_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Stream source' },
      { label: 'sse', kind: 'snippet', insertText: 'sse({\n  url: env(\'ENDPOINT_SSE\'),\n  withCredentials: false,\n  auth: \'inherit\',\n})', detail: 'SSE transport' },
      { label: 'websocket', kind: 'snippet', insertText: 'websocket({\n  url: env(\'ENDPOINT_WS\'),\n  onOpen: [{ method: \'subscribe\', params: { channel: \'ticker\' } }],\n})', detail: 'WebSocket transport с повторной подпиской' },
      { label: 'graphqlSse', kind: 'snippet', insertText: 'graphqlSse({\n  url: env(\'ENDPOINT_GRAPHQL_SSE\'),\n  method: \'POST\',\n  document: gql`subscription OnChanged($id: ID!) { changed(id: $id) { id } }`,\n  variables: variables(({ prop }) => ({ id: prop(\'id\') })),\n  auth: \'inherit\',\n  errorPolicy: \'throw\',\n  reconnectDelay: 3000,\n})', detail: 'GraphQL subscription по протоколу graphql-sse (события next и complete)' },
      { label: 'defineProps', kind: 'snippet', insertText: 'props: defineProps({\n  id: field(\'ID\'),\n}),', detail: 'Props Stream для variables и headers graphqlSse' },
      { label: 'variables', kind: 'function', insertText: 'variables(({ prop }) => ({ id: prop(\'id\') }))', detail: 'Variables GraphQL subscription из props' },
      { label: 'eventNext', kind: 'snippet', insertText: 'next: event({\n  type: \'domain.changed\',\n  payloadFrom: \'changed\',\n}),', detail: 'Событие next graphqlSse: payload читается из data результата' },
      { label: 'eventEach', kind: 'snippet', insertText: 'event({\n  match: { channel: \'ticker\' },\n  eachFrom: \'data\',\n  type: \'quote.updated\',\n})', detail: 'Отфильтровать сообщение и опубликовать событие для каждого элемента массива' },
      { label: 'auth.profile', kind: 'snippet', insertText: 'auth: {\n  mode: \'profile\',\n  profile: \'auth-profile-identity\',\n},', detail: 'Использовать именованный AuthProfile' },
      { label: 'env', kind: 'function', insertText: 'env(\'ENDPOINT_SSE\')', detail: 'Ссылка на environment variable' },
      { label: 'event', kind: 'function', insertText: 'event(\'domain.event\')', detail: 'Нормализовать transport event' },
      { label: 'eventFrom', kind: 'snippet', insertText: 'event({\n  typeFrom: \'eventInfo.name\',\n  payloadFrom: \'\',\n})', detail: 'Получить тип и payload из сообщения' },
    ]
  }
}
