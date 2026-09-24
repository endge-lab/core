import type { File, Node } from '@babel/types'
import type { ProgramArtifact } from '../domain/types/program.types'
import type {
  RComponentSFC_AST,
  RComponentSFC_AST_TemplateNode,
} from '@/features/core/modules/domain/types/component/sfc/ast.types'
import generate from '@babel/generator'

// Печатает имеющееся дерево без повторного parse/compile и без гарантии исходного форматирования.
export function restoreProgramArtifactSource(
  artifact: ProgramArtifact,
): string | null {
  const payload = artifact.payload as { ast?: unknown }
  if (!payload?.ast || typeof payload.ast !== 'object') {
    return null
  }
  if (
    artifact.ref.entityType === 'style'
    && 'source' in payload.ast
    && typeof payload.ast.source === 'string'
  ) {
    return payload.ast.source
  }
  if (artifact.ref.entityType === 'component-sfc') {
    const ast = payload.ast as RComponentSFC_AST
    const chunks: string[] = []
    if (ast.script) {
      const lang = ast.script.lang
        ? ` lang="${escapeAttribute(ast.script.lang)}"`
        : ''
      chunks.push(
        `<script${ast.script.setup ? ' setup' : ''}${lang}>\n${ast.script.content}\n</script>`,
      )
    }
    if (ast.template) {
      chunks.push(
        `<template>\n${ast.template.roots.map(printTemplateNode).join('')}\n</template>`,
      )
    }
    if (ast.style) {
      chunks.push(
        `<style${ast.style.lang ? ` lang="${escapeAttribute(ast.style.lang)}"` : ''}${ast.style.scoped ? ' scoped' : ''}>\n${ast.style.content}\n</style>`,
      )
    }
    return chunks.join('\n\n')
  }
  const ast = payload.ast as Node | { syntax?: File }
  const node = 'syntax' in ast ? ast.syntax : ast
  if (
    node
    && 'type' in node
    && (node.type === 'File' || node.type === 'Program')
  ) {
    return generate(node as Parameters<typeof generate>[0], { comments: true })
      .code
  }
  return null
}

function printTemplateNode(node: RComponentSFC_AST_TemplateNode): string {
  if (node.kind === 'comment') {
    return `<!--${node.content}-->`
  }
  if (node.kind === 'text') {
    return node.content.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  }
  if (node.kind === 'interpolation') {
    return `{{ ${node.expression} }}`
  }
  const attributes = node.attributes.map(
    attribute =>
      `${attribute.dynamic ? ':' : ''}${attribute.name}${attribute.modifiers.length ? `.${attribute.modifiers.join('.')}` : ''}${attribute.value === null ? '' : `="${escapeAttribute(attribute.value)}"`}`,
  )
  for (const directive of node.directives) {
    attributes.push(
      `v-${directive.name}${directive.argument ? `:${directive.argument}` : ''}${directive.modifiers.length ? `.${directive.modifiers.join('.')}` : ''}${directive.expression === undefined ? '' : `="${escapeAttribute(directive.expression)}"`}`,
    )
  }
  const head = `<${node.tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}`
  return node.selfClosing
    ? `${head} />`
    : `${head}>${node.children.map(printTemplateNode).join('')}</${node.tag}>`
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
}
