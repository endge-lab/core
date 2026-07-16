import type {
  SourceKind,
  SourceLanguageCompletion,
  SourceLanguageContext,
  SourceLanguageStrategy,
  SourceLanguageValidationResult,
} from '@/domain/types/source/source-engine.types'

import { ENDGE_STYLE_DEFAULT_SOURCE } from '@/domain/entities/reflect/RStyle'
import { compileEndgeCSS } from '@/model/services/style'

export class StyleSourceLanguageStrategy implements SourceLanguageStrategy {
  public readonly id = 'source-language:style'
  public readonly sourceKind: SourceKind = 'style'
  public readonly syntax = {
    aliases: ['EndgeCSS', 'endgecss'],
    extensions: ['.endgecss'],
    comments: { lineComment: '//', blockComment: ['/*', '*/'] as [string, string] },
    brackets: [['{', '}'], ['(', ')'], ['[', ']']] as Array<[string, string]>,
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    triggerCharacters: [':', '@', '.', '#', '-'],
    tokenizer: {
      root: [
        { pattern: /\/\*/, token: 'comment', next: '@comment' },
        { pattern: /\/\/.*$/, token: 'comment' },
        { pattern: /@(theme|scope|supports|layer)\b/, token: 'keyword' },
        { pattern: /::?(component|identity|state|part|slot|first-child|last-child|nth-child|not|is|where)\b/, token: 'type.identifier' },
        { pattern: /#[\w-]+/, token: 'tag.id' },
        { pattern: /\.[\w-]+/, token: 'tag.class' },
        { pattern: /--[\w-]+/, token: 'variable' },
        { pattern: /!important\b/, token: 'keyword' },
      ],
      comment: [
        { pattern: /[^*/]+/, token: 'comment' },
        { pattern: /\*\//, token: 'comment', next: '@pop' },
        { pattern: /[*/]/, token: 'comment' },
      ],
    },
  }

  public supports(sourceKind: SourceKind | string): boolean {
    return sourceKind === this.sourceKind
  }

  public createDefaultSource(): string {
    return ENDGE_STYLE_DEFAULT_SOURCE
  }

  public validate(source: string): SourceLanguageValidationResult {
    const result = compileEndgeCSS(source)
    const ok = result.artifact !== null
    return { ok, diagnostics: result.diagnostics, message: ok ? undefined : 'EndgeCSS source contains validation errors.' }
  }

  public completions(_context: SourceLanguageContext): SourceLanguageCompletion[] {
    return [
      { label: '@theme', kind: 'snippet', insertText: '@theme dark {\n  --surface: #111827;\n\n  & {\n    color: var(--text);\n  }\n}', detail: 'Theme tokens and rules' },
      { label: '@scope', kind: 'snippet', insertText: '@scope (:component(FlightBoard)) {\n  $0\n}', detail: 'Limit rules to an abstract subtree' },
      { label: '@supports renderer', kind: 'snippet', insertText: '@supports renderer(dom) {\n  $0\n}', detail: 'Renderer-specific optional styles' },
      { label: ':component()', kind: 'function', insertText: ':component(${1:FlightBoard})', detail: 'Public component tag' },
      { label: ':identity()', kind: 'function', insertText: ':identity(${1:flight-board})', detail: 'Stable component identity' },
      { label: ':state()', kind: 'function', insertText: ':state(${1:selected})', detail: 'Semantic runtime state' },
      { label: '::part()', kind: 'function', insertText: '::part(${1:status})', detail: 'Public visual surface' },
      { label: 'var()', kind: 'function', insertText: 'var(--${1:token})', detail: 'Read an EndgeCSS custom property' },
    ]
  }
}
