import type { SourceLanguageSyntaxDefinition } from '@/domain/types/source/source-engine.types'

interface TypeScriptLikeSourceSyntaxOptions {
  alias: string
  extension: string
  keywords: string[]
  functions?: string[]
  properties?: string[]
}

const COMMON_KEYWORDS = [
  'async',
  'await',
  'const',
  'else',
  'false',
  'if',
  'let',
  'null',
  'return',
  'true',
  'undefined',
]

/** Создает общий TypeScript-like tokenizer, добавляя vocabulary конкретного DSL. */
export function createTypeScriptLikeSourceSyntax(
  options: TypeScriptLikeSourceSyntaxOptions,
): SourceLanguageSyntaxDefinition {
  return {
    aliases: [options.alias],
    extensions: [options.extension],
    comments: {
      lineComment: '//',
      blockComment: ['/*', '*/'],
    },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '\'', close: '\'' },
      { open: '"', close: '"' },
      { open: '`', close: '`' },
    ],
    triggerCharacters: ['.', ':', '\'', '"'],
    tokenizer: {
      root: [
        { pattern: /\/\/.*$/, token: 'comment' },
        { pattern: /\/\*/, token: 'comment', next: '@comment' },
        { pattern: /`(?:[^`\\]|\\.)*`/, token: 'string' },
        { pattern: /'(?:[^'\\]|\\.)*'/, token: 'string' },
        { pattern: /"(?:[^"\\]|\\.)*"/, token: 'string' },
        { pattern: /\b\d+(?:\.\d+)?\b/, token: 'number' },
        { pattern: wordPattern([...COMMON_KEYWORDS, ...options.keywords]), token: 'keyword' },
        { pattern: wordPattern(options.functions ?? []), token: 'function' },
        { pattern: wordPattern(options.properties ?? []), token: 'type.identifier' },
      ],
      comment: [
        { pattern: /[^/*]+/, token: 'comment' },
        { pattern: /\*\//, token: 'comment', next: '@pop' },
        { pattern: /[/*]/, token: 'comment' },
      ],
    },
  }
}

function wordPattern(words: string[]): RegExp {
  const alternatives = [...new Set(words.filter(Boolean))]
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  return alternatives ? new RegExp(`\\b(?:${alternatives})\\b`) : /(?!)/
}
