import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/domain/types/source/source-engine.types'

import { compileUpdateSource } from '@/model/services/source-engine/compilers/update-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/model/services/source-engine/source-language-syntax'
import { UPDATE_DEFAULT_SOURCE } from '@/model/services/source-engine/templates/update.default.source'

export class UpdateSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:update'
  public readonly sourceKind: SourceKind = 'update'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Update Source',
    extension: '.endge-update.ts',
    keywords: ['defineUpdate', 'set', 'merge', 'replace', 'append', 'remove'],
    functions: ['defineUpdate'],
    properties: ['handles', 'strategy', 'target', 'keyFrom', 'valueFrom'],
  })

  public supports(sourceKind: SourceKind | string): boolean { return sourceKind === this.sourceKind }
  public createDefaultSource(): string { return UPDATE_DEFAULT_SOURCE }
  public validate(source: string): SourceLanguageValidationResult {
    const result = compileUpdateSource(source)
    const ok = !result.diagnostics.some(item => item.severity === 'error')
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'Update source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      { label: 'defineUpdate', kind: 'snippet', insertText: UPDATE_DEFAULT_SOURCE.trimEnd(), detail: 'Создать Store Update source' },
      { label: 'handles', kind: 'property', insertText: "handles: 'domain.event',", detail: 'Канонический event type для dispatch' },
      { label: 'strategy', kind: 'property', insertText: "strategy: 'merge',", detail: 'set | merge | replace | append | remove' },
      { label: 'target', kind: 'property', insertText: "target: 'items[id=$key]',", detail: 'Store-relative индексированный Raph path' },
      { label: 'keyFrom', kind: 'property', insertText: "keyFrom: 'id',", detail: 'Payload path для $key' },
      { label: 'valueFrom', kind: 'property', insertText: "valueFrom: '',", detail: 'Payload path; пустая строка означает весь payload' },
    ]
  }
}
