import { describe, expect, it } from 'vitest'

import { createEndgeTooltipDomId, parseEndgeTooltipMarkdown } from '@/features/core/modules/ui/tooltip/endge-tooltip-markdown'

describe('проверка Markdown всплывающей подсказки', () => {
  it('разбирает безопасное подмножество блоков и inline-разметки без генерации HTML', () => {
    const blocks = parseEndgeTooltipMarkdown(`# Delay

**Reason:** late aircraft

- plan: \`12:40\`
- forecast: *13:05*

\`\`\`
<script>alert(1)</script>
\`\`\``)

    expect(blocks.map(block => block.kind)).toEqual(['heading', 'paragraph', 'list', 'code-block'])
    expect(blocks.at(-1)).toEqual({ kind: 'code-block', value: '<script>alert(1)</script>' })
  })

  it('отбрасывает небезопасные протоколы ссылок и создаёт стабильные DOM ID в scope', () => {
    expect(parseEndgeTooltipMarkdown('[unsafe](javascript:alert(1))')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', value: 'unsafe)' }] },
    ])
    expect(createEndgeTooltipDomId('runtime:row-1:status')).toBe(createEndgeTooltipDomId('runtime:row-1:status'))
    expect(createEndgeTooltipDomId('runtime:row-1:status')).not.toBe(createEndgeTooltipDomId('runtime:row-2:status'))
  })
})
