import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/domain/types/source/source-engine.types'

import { compileStreamSource } from '@/model/services/source-engine/compilers/stream-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { STREAM_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/stream.default.source'

export class StreamSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:stream'
  public readonly sourceKind: SourceKind = 'stream'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Stream Source',
    extension: '.endge-stream.ts',
    keywords: ['defineStream', 'sse', 'event'],
    functions: ['defineStream', 'sse', 'event'],
    properties: ['transport', 'events', 'url', 'withCredentials'],
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
      { label: 'sse', kind: 'snippet', insertText: "sse({\n  url: '/events',\n  withCredentials: false,\n})", detail: 'SSE transport' },
      { label: 'event', kind: 'function', insertText: "event('domain.event')", detail: 'Нормализовать transport event' },
    ]
  }
}
