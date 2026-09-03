import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/modules/source/domain/types/source-engine.types'

import { compileUpdateSource } from '@/modules/source/services/compilers/update-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/modules/source/services/source-language-syntax'
import { UPDATE_DEFAULT_SOURCE } from '@/modules/source/templates/update.default.source'

export class UpdateSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:update'
  public readonly sourceKind: SourceKind = 'update'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Update Source',
    extension: '.endge-update.ts',
    keywords: ['defineUpdate', 'set', 'merge', 'replace', 'append', 'remove'],
    functions: ['defineUpdate'],
    properties: ['handles', 'mutations', 'strategy', 'target', 'forEach', 'ifExists', 'valueFrom', 'vars'],
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
      { label: 'handles', kind: 'property', insertText: 'handles: [\'domain.created\', \'domain.updated\'],', detail: 'Канонические event types для dispatch' },
      { label: 'mutations', kind: 'snippet', insertText: 'mutations: [\n  {\n    strategy: \'merge\',\n    target: \'items[id=$id]\',\n    ifExists: null,\n    valueFrom: \'\',\n    vars: { id: \'id\' },\n  },\n],', detail: 'Атомарный набор индексированных Store mutations' },
      { label: 'strategy', kind: 'property', insertText: 'strategy: \'merge\',', detail: 'set | merge | replace | append | remove' },
      { label: 'target', kind: 'property', insertText: 'target: \'items[id=$id]\',', detail: 'Store-relative индексированный Raph path' },
      { label: 'forEach', kind: 'property', insertText: 'forEach: \'items[]\',', detail: 'Развернуть mutation для элементов payload array' },
      { label: 'ifExists', kind: 'property', insertText: 'ifExists: \'items[id=$id]\',', detail: 'Не создавать ветку, если guard path отсутствует' },
      { label: 'vars', kind: 'property', insertText: 'vars: { id: \'id\' },', detail: 'Selector variables и payload paths' },
      { label: 'valueFrom', kind: 'property', insertText: 'valueFrom: \'\',', detail: 'Payload path; пустая строка означает весь payload' },
    ]
  }
}
