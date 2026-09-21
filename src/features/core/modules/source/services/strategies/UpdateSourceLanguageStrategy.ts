import type { SourceKind, SourceLanguageCompletion, SourceLanguageContext, SourceLanguageStrategy, SourceLanguageValidationResult } from '@/features/core/modules/source/domain/types/source-engine.types'

import { compileUpdateSource } from '@/features/core/modules/source/services/compilers/update-source-compile'
import { createTypeScriptLikeSourceSyntax } from '@/features/core/modules/source/services/source-language-syntax'
import { VALUE_EXPRESSION_COMPLETIONS, VALUE_EXPRESSION_FUNCTION_NAMES, VALUE_EXPRESSION_METHOD_NAMES } from '@/features/core/modules/source/services/value-expression-language'
import { UPDATE_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/update.default.source'

export class UpdateSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:update'
  public readonly sourceKind: SourceKind = 'update'
  public readonly syntax = createTypeScriptLikeSourceSyntax({
    alias: 'Endge Update Source',
    extension: '.endge-update.ts',
    keywords: ['defineUpdate', 'set', 'merge', 'replace', 'append', 'remove'],
    functions: ['defineUpdate', 'input', 'item', 'parent', 'data', 'meta', 'hasData', 'hasMeta', ...VALUE_EXPRESSION_FUNCTION_NAMES, ...VALUE_EXPRESSION_METHOD_NAMES],
    properties: ['handles', 'mutations', 'strategy', 'target', 'forEach', 'ifExists', 'valueFrom', 'value', 'when', 'vars'],
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
      { label: 'meta target', kind: 'snippet', insertText: 'target: meta(\'items[id=$id].value\', \'namespace\'),', detail: 'Meta-plane target существующего Store field' },
      { label: 'forEach', kind: 'property', insertText: 'forEach: \'items[]\',', detail: 'Развернуть mutation для элементов payload array' },
      { label: 'ifExists', kind: 'property', insertText: 'ifExists: \'items[id=$id]\',', detail: 'Не создавать ветку, если guard path отсутствует' },
      { label: 'vars', kind: 'property', insertText: 'vars: { id: \'id\' },', detail: 'Selector variables и payload paths' },
      { label: 'valueFrom', kind: 'property', insertText: 'valueFrom: \'\',', detail: 'Payload path; пустая строка означает весь payload' },
      { label: 'value', kind: 'property', insertText: 'value: input(\'value\'),', detail: 'Безопасный ValueExpression результата mutation' },
      { label: 'when', kind: 'property', insertText: 'when: input().has(\'value\'),', detail: 'Безопасное условие выполнения mutation' },
      { label: 'input', kind: 'function', insertText: 'input(\'path\')', detail: 'Корневой payload Update; path необязателен' },
      { label: 'item', kind: 'function', insertText: 'item(\'path\')', detail: 'Текущий элемент forEach; без forEach равен input' },
      { label: 'parent', kind: 'function', insertText: 'parent(\'path\')', detail: 'Родитель текущего элемента forEach' },
      { label: 'data', kind: 'function', insertText: 'data(\'items[id=$id].value\')', detail: 'Читает pre-update Data текущего Store' },
      { label: 'meta', kind: 'function', insertText: 'meta(\'items[id=$id].value\', \'namespace\')', detail: 'Читает pre-update Meta текущего Store' },
      { label: 'hasData', kind: 'function', insertText: 'hasData(\'items[id=$id].value\')', detail: 'Проверяет существование pre-update Data path' },
      { label: 'hasMeta', kind: 'function', insertText: 'hasMeta(\'items[id=$id].value\', \'namespace\')', detail: 'Проверяет существование pre-update Meta namespace' },
      ...VALUE_EXPRESSION_COMPLETIONS,
    ]
  }
}
