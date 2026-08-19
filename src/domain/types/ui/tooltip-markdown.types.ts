export type EndgeTooltipMarkdownInline =
  | { kind: 'text', value: string }
  | { kind: 'strong', children: EndgeTooltipMarkdownInline[] }
  | { kind: 'emphasis', children: EndgeTooltipMarkdownInline[] }
  | { kind: 'code', value: string }
  | { kind: 'link', href: string, children: EndgeTooltipMarkdownInline[] }

export type EndgeTooltipMarkdownBlock =
  | { kind: 'heading', level: 1 | 2 | 3, children: EndgeTooltipMarkdownInline[] }
  | { kind: 'paragraph', children: EndgeTooltipMarkdownInline[] }
  | { kind: 'list', ordered: boolean, items: EndgeTooltipMarkdownInline[][] }
  | { kind: 'code-block', value: string }

