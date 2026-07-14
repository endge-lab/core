import type { RComponentSFCSource_Parts } from '@/domain/types/component/sfc'

/** Создает пустые sourceParts для нового компонента. */
export function createEmptySFCSourceParts(): RComponentSFCSource_Parts {
  return {
    script: {
      content: '',
    },
    template: {
      content: '',
    },
    style: {
      content: '',
      scoped: true,
    },
  }
}

/** Создает глубокую копию вкладок source без привязки к редакторскому объекту. */
export function cloneSFCSourceParts(parts: RComponentSFCSource_Parts): RComponentSFCSource_Parts {
  return {
    script: {
      content: parts.script.content,
    },
    template: {
      content: parts.template.content,
    },
    style: {
      content: parts.style.content,
      scoped: parts.style.scoped,
    },
  }
}

/** Сериализует вкладки конфигуратора в полноценный .endge SFC. */
export function serializeSFCSourceParts(parts: RComponentSFCSource_Parts): string {
  const chunks: string[] = []
  const styleScoped = parts.style.scoped ? ' scoped' : ''

  chunks.push('<script setup lang="ts">')
  chunks.push(parts.script.content.trim())
  chunks.push('</script>')
  chunks.push('')
  chunks.push('<template>')
  chunks.push(parts.template.content.trim())
  chunks.push('</template>')

  if (parts.style.content.trim()) {
    chunks.push('')
    chunks.push(`<style lang="endgecss"${styleScoped}>`)
    chunks.push(parts.style.content.trim())
    chunks.push('</style>')
  }

  return `${chunks.join('\n')}\n`
}

/** Разбирает простой SFC-source на вкладки редактора v1. */
export function parseSFCSourceParts(source: string): RComponentSFCSource_Parts {
  const parts = createEmptySFCSourceParts()
  const input = source ?? ''

  parts.script.content = extractBlock(input, 'script') ?? ''
  parts.template.content = extractBlock(input, 'template') ?? ''
  const styleMatch = extractBlockWithAttrs(input, 'style')
  parts.style.content = styleMatch?.content ?? ''
  parts.style.scoped = Boolean(styleMatch?.attrs.includes('scoped'))

  return parts
}

/** Вытаскивает содержимое первого тега без попытки заменить полноценный compiler-parser. */
function extractBlock(source: string, tag: string): string | null {
  return extractBlockWithAttrs(source, tag)?.content ?? null
}

/** Вытаскивает содержимое первого тега вместе с атрибутами. */
function extractBlockWithAttrs(source: string, tag: string): { attrs: string, content: string } | null {
  const pattern = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const match = source.match(pattern)
  if (!match) return null

  return {
    attrs: match[1] ?? '',
    content: (match[2] ?? '').trim(),
  }
}
