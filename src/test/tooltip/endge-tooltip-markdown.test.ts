import { describe, expect, it } from 'vitest'

import { createEndgeTooltipDomId, parseEndgeTooltipMarkdown } from '@/model/services/tooltip/endge-tooltip-markdown'

describe('tooltip Markdown', () => {
  it('parses the safe block and inline subset without producing HTML', () => {
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

  it('drops unsafe link protocols and creates stable scoped DOM ids', () => {
    expect(parseEndgeTooltipMarkdown('[unsafe](javascript:alert(1))')).toEqual([
      { kind: 'paragraph', children: [{ kind: 'text', value: 'unsafe)' }] },
    ])
    expect(createEndgeTooltipDomId('runtime:row-1:status')).toBe(createEndgeTooltipDomId('runtime:row-1:status'))
    expect(createEndgeTooltipDomId('runtime:row-1:status')).not.toBe(createEndgeTooltipDomId('runtime:row-2:status'))
  })
})
