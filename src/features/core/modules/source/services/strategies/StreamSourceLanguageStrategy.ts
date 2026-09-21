import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import { STREAM_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/stream.default.source'

export class StreamSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:stream'
  public readonly sourceKind: SourceKind = 'stream'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Stream Source',
    extension: '.endge-stream.ts',
    keywords: ['defineStream', 'sse', 'websocket', 'event', 'env'],
    functions: ['defineStream', 'sse', 'websocket', 'event', 'env'],
    properties: ['transport', 'events', 'url', 'withCredentials', 'auth', 'mode', 'profile', 'type', 'typeFrom', 'payloadFrom', 'onOpen', 'match', 'eachFrom'],
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
      { label: 'defineStream', kind: 'snippet', insertText: STREAM_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Stream source' },
      { label: 'sse', kind: 'snippet', insertText: 'sse({\n  url: env(\'ENDPOINT_SSE\'),\n  withCredentials: false,\n  auth: \'inherit\',\n})', detail: 'SSE transport' },
      { label: 'websocket', kind: 'snippet', insertText: 'websocket({\n  url: env(\'ENDPOINT_WS\'),\n  onOpen: [{ method: \'subscribe\', params: { channel: \'ticker\' } }],\n})', detail: 'WebSocket transport с повторной подпиской' },
      { label: 'eventEach', kind: 'snippet', insertText: 'event({\n  match: { channel: \'ticker\' },\n  eachFrom: \'data\',\n  type: \'quote.updated\',\n})', detail: 'Отфильтровать сообщение и опубликовать событие для каждого элемента массива' },
      { label: 'auth.profile', kind: 'snippet', insertText: 'auth: {\n  mode: \'profile\',\n  profile: \'auth-profile-identity\',\n},', detail: 'Использовать именованный AuthProfile' },
      { label: 'env', kind: 'function', insertText: 'env(\'ENDPOINT_SSE\')', detail: 'Ссылка на environment variable' },
      { label: 'event', kind: 'function', insertText: 'event(\'domain.event\')', detail: 'Нормализовать transport event' },
      { label: 'eventFrom', kind: 'snippet', insertText: 'event({\n  typeFrom: \'eventInfo.name\',\n  payloadFrom: \'\',\n})', detail: 'Получить тип и payload из сообщения' },
    ]
  }
}
