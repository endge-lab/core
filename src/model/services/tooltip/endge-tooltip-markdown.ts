import type {
  EndgeTooltipMarkdownBlock,
  EndgeTooltipMarkdownInline,
} from '@/domain/types/ui/tooltip-markdown.types'

/** Parses the intentionally small, safe Tooltip Markdown subset without producing HTML. */
export function parseEndgeTooltipMarkdown(source: unknown): EndgeTooltipMarkdownBlock[] {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks: EndgeTooltipMarkdownBlock[] = []

  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? ''
    if (!line.trim()) {
      index += 1
      continue
    }

    if (line.trimStart().startsWith('```')) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trimStart().startsWith('```')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ kind: 'code-block', value: body.join('\n') })
      continue
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/)
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        children: parseInline(heading[2]!),
      })
      index += 1
      continue
    }

    const list = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/)
    if (list) {
      const ordered = Boolean(list[2])
      const items: EndgeTooltipMarkdownInline[][] = []
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/)
        if (!item || Boolean(item[2]) !== ordered) break
        items.push(parseInline(item[3]!))
        index += 1
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    const paragraph: string[] = [line.trim()]
    index += 1
    while (index < lines.length && (lines[index] ?? '').trim() && !startsBlock(lines[index] ?? '')) {
      paragraph.push((lines[index] ?? '').trim())
      index += 1
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) })
  }

  return blocks
}

/** Stable DOM id for one consumer-scoped tooltip without leaking source values into selectors. */
export function createEndgeTooltipDomId(seed: string): string {
  let hash = 0x811C9DC5
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `endge-tooltip-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function startsBlock(line: string): boolean {
  return /^\s{0,3}(?:#{1,3}\s+|```)/.test(line)
    || /^\s*(?:[-+*]|\d+\.)\s+/.test(line)
}

function parseInline(source: string): EndgeTooltipMarkdownInline[] {
  const result: EndgeTooltipMarkdownInline[] = []
  const pattern = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\))/g
  let offset = 0
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > offset) result.push({ kind: 'text', value: source.slice(offset, start) })
    if (match[2] != null) result.push({ kind: 'strong', children: parseInline(match[2]) })
    else if (match[3] != null) result.push({ kind: 'code', value: match[3] })
    else if (match[4] != null) result.push({ kind: 'emphasis', children: parseInline(match[4]) })
    else if (match[5] != null && match[6] != null) {
      const href = safeHref(match[6])
      result.push(href
        ? { kind: 'link', href, children: parseInline(match[5]) }
        : { kind: 'text', value: match[5] })
    }
    offset = start + match[0].length
  }
  if (offset < source.length) result.push({ kind: 'text', value: source.slice(offset) })
  return mergeAdjacentText(result)
}

function mergeAdjacentText(nodes: EndgeTooltipMarkdownInline[]): EndgeTooltipMarkdownInline[] {
  const result: EndgeTooltipMarkdownInline[] = []
  for (const node of nodes) {
    const previous = result.at(-1)
    if (node.kind === 'text' && previous?.kind === 'text') previous.value += node.value
    else result.push(node)
  }
  return result
}

function safeHref(value: string): string | null {
  const normalized = value.trim()
  return /^(?:https?:\/\/|mailto:|\/|#)/i.test(normalized) ? normalized : null
}
