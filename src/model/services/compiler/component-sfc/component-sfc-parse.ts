import { parse as parseSFC } from '@vue/compiler-sfc'
import {
  NodeTypes,
  type AttributeNode,
  type DirectiveNode,
  type ElementNode,
  type InterpolationNode,
  type RootNode,
  type SourceLocation,
  type TextNode,
  baseParse,
} from '@vue/compiler-dom'
import { parse as parseTS } from '@babel/parser'

import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'
import type {
  RComponentSFCSource_Parts,
  RComponentSFC_AST,
  RComponentSFC_AST_Attribute,
  RComponentSFC_AST_Directive,
  RComponentSFC_AST_ElementNode,
  RComponentSFC_AST_InterpolationNode,
  RComponentSFC_AST_MetadataDeclaration,
  RComponentSFC_AST_PreviewPropsDeclaration,
  RComponentSFC_AST_PropsDeclaration,
  RComponentSFC_AST_Script,
  RComponentSFC_AST_ScriptBinding,
  RComponentSFC_AST_Style,
  RComponentSFC_AST_Template,
  RComponentSFC_AST_TemplateNode,
  RComponentSFC_AST_TextNode,
  RComponentSFC_SourceRange,
} from '@/domain/types/component/sfc'
import { parseSFCSourceParts } from '@/model/services/compiler/component-sfc/component-sfc-source-parts'

/** Результат parser pass для SFC-компонента. */
export interface ComponentSFCParseResult {
  /** Разложенный source для editor/debug UI. */
  sourceParts: RComponentSFCSource_Parts

  /** Stable AST, независимый от внутренних типов Vue parser. */
  ast: RComponentSFC_AST | null

  /** Diagnostics parser pass. */
  diagnostics: RComponentDiagnostic[]
}

/** Разбирает SFC source в stable AST без построения semantic IR. */
export function parseComponentSFC(source: string): ComponentSFCParseResult {
  const input = normalizeComponentSFCInput(source ?? '')
  const sourceParts = parseSFCSourceParts(input)
  const diagnostics: RComponentDiagnostic[] = []

  if (!input.trim()) {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-source-empty',
      message: 'SFC-компонент не содержит source.',
    })

    return {
      sourceParts,
      ast: null,
      diagnostics,
    }
  }

  const parsed = parseSFC(input, {
    filename: 'component.endge',
  })

  for (const error of parsed.errors)
    diagnostics.push(toParserDiagnostic(error))

  const descriptor = parsed.descriptor
  const script = descriptor.scriptSetup
    ? parseScriptBlock(descriptor.scriptSetup)
    : null
  const template = descriptor.template
    ? parseTemplateBlock(descriptor.template.content, rangeFromLoc(descriptor.template.loc))
    : null
  const styleBlock = descriptor.styles[0]
  const style = styleBlock
    ? parseStyleBlock(styleBlock)
    : null

  if (!descriptor.scriptSetup) {
    diagnostics.push({
      severity: 'warning',
      code: 'sfc-script-setup-missing',
      message: 'SFC-компонент не содержит <script setup>.',
      sourcePath: 'script',
    })
  }

  if (!descriptor.template) {
    diagnostics.push({
      severity: 'error',
      code: 'sfc-template-missing',
      message: 'SFC-компонент должен содержать <template>.',
      sourcePath: 'template',
    })
  }

  return {
    sourceParts,
    ast: {
      version: 1,
      script,
      template,
      style,
    },
    diagnostics,
  }
}

function normalizeComponentSFCInput(source: string): string {
  const input = source ?? ''
  const trimmed = input.trim()
  if (!trimmed)
    return input

  try {
    const parsed = parseSFC(trimmed, {
      filename: 'component.endge',
    })

    const templateContent = parsed.descriptor.template?.content?.trim()
    if (!templateContent || !/<script\b/i.test(templateContent) || !/<template\b/i.test(templateContent))
      return input

    const nested = parseSFC(templateContent, {
      filename: 'component.endge',
    })

    if (nested.descriptor.template && (nested.descriptor.script || nested.descriptor.scriptSetup || nested.descriptor.styles.length > 0))
      return `${templateContent}\n`
  }
  catch {
    return input
  }

  return input
}

function parseScriptBlock(block: { content: string, attrs: Record<string, any>, loc: SourceLocation }): RComponentSFC_AST_Script {
  const content = block.content ?? ''
  const range = rangeFromLoc(block.loc)

  return {
    lang: typeof block.attrs.lang === 'string' ? block.attrs.lang : null,
    setup: true,
    content,
    props: extractPropsDeclaration(content, range.start),
    previewProps: extractPreviewPropsDeclaration(content, range.start),
    metadata: extractMetadataDeclarations(content, range.start),
    bindings: extractScriptBindings(content, range.start),
    range,
  }
}

function parseTemplateBlock(content: string, range: RComponentSFC_SourceRange): RComponentSFC_AST_Template {
  const root = baseParse(content, {
    decodeEntities: decodeTemplateEntities,
  }) as RootNode

  return {
    roots: root.children
      .map(node => mapTemplateNode(node, range.start))
      .filter((node): node is RComponentSFC_AST_TemplateNode => node != null),
    range,
  }
}

function decodeTemplateEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .replace(/&amp;/g, '&')
}

function parseStyleBlock(block: { content: string, attrs: Record<string, any>, loc: SourceLocation }): RComponentSFC_AST_Style {
  return {
    lang: typeof block.attrs.lang === 'string' ? block.attrs.lang : null,
    scoped: Boolean(block.attrs.scoped),
    content: block.content ?? '',
    range: rangeFromLoc(block.loc),
  }
}

function mapTemplateNode(node: RootNode['children'][number], baseOffset: number): RComponentSFC_AST_TemplateNode | null {
  if (node.type === NodeTypes.TEXT)
    return mapTextNode(node as TextNode, baseOffset)

  if (node.type === NodeTypes.INTERPOLATION)
    return mapInterpolationNode(node as InterpolationNode, baseOffset)

  if (node.type === NodeTypes.ELEMENT)
    return mapElementNode(node as ElementNode, baseOffset)

  return null
}

function mapElementNode(node: ElementNode, baseOffset: number): RComponentSFC_AST_ElementNode {
  const attributes: RComponentSFC_AST_Attribute[] = []
  const directives: RComponentSFC_AST_Directive[] = []

  for (const prop of node.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      if (isControlDirectiveName(prop.name)) {
        directives.push(attributeToDirective(prop, baseOffset))
      }
      else {
        attributes.push({
          name: prop.name,
          value: prop.value?.content ?? null,
          dynamic: false,
          range: rangeFromLoc(prop.loc, baseOffset),
        })
      }
      continue
    }

    const directive = prop as DirectiveNode
    const arg = directive.arg?.type === NodeTypes.SIMPLE_EXPRESSION ? directive.arg.content : undefined
    const expression = directive.exp?.type === NodeTypes.SIMPLE_EXPRESSION ? directive.exp.content : undefined

    if (directive.name === 'bind' && arg && !isControlDirectiveName(arg)) {
      attributes.push({
        name: arg,
        value: expression ?? null,
        dynamic: true,
        range: rangeFromLoc(directive.loc, baseOffset),
      })
    }
    else {
      directives.push({
        name: directive.name === 'bind' && arg === 'key' ? 'key' : directive.name,
        argument: arg,
        expression,
        range: rangeFromLoc(directive.loc, baseOffset),
      })
    }
  }

  return {
    kind: 'element',
    tag: node.tag,
    attributes,
    directives,
    children: node.children
      .map(child => mapTemplateNode(child, baseOffset))
      .filter((child): child is RComponentSFC_AST_TemplateNode => child != null),
    selfClosing: Boolean(node.isSelfClosing),
    range: rangeFromLoc(node.loc, baseOffset),
  }
}

function mapTextNode(node: TextNode, baseOffset: number): RComponentSFC_AST_TextNode {
  return {
    kind: 'text',
    content: node.content,
    range: rangeFromLoc(node.loc, baseOffset),
  }
}

function mapInterpolationNode(node: InterpolationNode, baseOffset: number): RComponentSFC_AST_InterpolationNode {
  return {
    kind: 'interpolation',
    expression: node.content.loc.source.trim(),
    range: rangeFromLoc(node.loc, baseOffset),
  }
}

function attributeToDirective(attribute: AttributeNode, baseOffset: number): RComponentSFC_AST_Directive {
  return {
    name: attribute.name,
    expression: attribute.value?.content,
    range: rangeFromLoc(attribute.loc, baseOffset),
  }
}

function isControlDirectiveName(name: string): boolean {
  return name === 'if' || name === 'else-if' || name === 'else' || name === 'for' || name === 'key'
}

function extractPropsDeclaration(content: string, baseOffset: number): RComponentSFC_AST_PropsDeclaration | null {
  const match = content.match(/defineProps\s*(?:<([\s\S]*?)>\s*)?\(([\s\S]*?)\)/m)
  if (!match || match.index == null)
    return null

  const typeSource = match[1]?.trim()
  const runtimeSource = match[2]?.trim()
  const source = typeSource || runtimeSource || ''
  const start = baseOffset + match.index

  return {
    source,
    mode: typeSource ? 'type' : 'runtime',
    range: {
      start,
      end: start + match[0].length,
    },
  }
}

function extractPreviewPropsDeclaration(content: string, baseOffset: number): RComponentSFC_AST_PreviewPropsDeclaration | null {
  try {
    const ast = parseTS(content, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any

    for (const statement of ast.program.body as any[]) {
      const expression = statement.type === 'ExpressionStatement'
        ? statement.expression
        : null

      if (
        expression?.type !== 'CallExpression'
        || expression.callee?.type !== 'Identifier'
        || expression.callee.name !== 'definePreviewProps'
      ) {
        continue
      }

      const argument = expression.arguments?.[0]
      if (!argument || argument.start == null || argument.end == null)
        return null
      const optionsArgument = expression.arguments?.[1]

      return {
        source: content.slice(argument.start, argument.end).trim(),
        optionsSource: optionsArgument?.start != null && optionsArgument?.end != null
          ? content.slice(optionsArgument.start, optionsArgument.end).trim()
          : null,
        range: {
          start: baseOffset + Number(statement.start ?? argument.start),
          end: baseOffset + Number(statement.end ?? argument.end),
        },
      }
    }
  }
  catch {
    return null
  }

  return null
}

function extractMetadataDeclarations(content: string, baseOffset: number): RComponentSFC_AST_MetadataDeclaration[] {
  const declarations: RComponentSFC_AST_MetadataDeclaration[] = []

  try {
    const ast = parseTS(content, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any

    for (const statement of ast.program.body as any[]) {
      const expression = statement.type === 'ExpressionStatement'
        ? statement.expression
        : null

      if (
        expression?.type !== 'CallExpression'
        || expression.callee?.type !== 'Identifier'
        || expression.callee.name !== 'defineMetadata'
      ) {
        continue
      }

      const argument = expression.arguments?.[0]
      if (!argument || argument.start == null || argument.end == null)
        continue

      declarations.push({
        source: content.slice(argument.start, argument.end).trim(),
        range: {
          start: baseOffset + Number(statement.start ?? argument.start),
          end: baseOffset + Number(statement.end ?? argument.end),
        },
      })
    }
  }
  catch {
    return declarations
  }

  return declarations
}

function extractScriptBindings(content: string, baseOffset: number): RComponentSFC_AST_ScriptBinding[] {
  const bindings: RComponentSFC_AST_ScriptBinding[] = []

  try {
    const ast = parseTS(content, {
      sourceType: 'module',
      plugins: ['typescript'],
    }) as any

    for (const statement of ast.program.body as any[]) {
      if (statement.type === 'ImportDeclaration') {
        for (const specifier of statement.specifiers ?? []) {
          const name = specifier.local?.name
          if (name)
            bindings.push(makeScriptBinding(name, 'import', statement, baseOffset))
        }
      }

      if (statement.type === 'FunctionDeclaration' && statement.id?.name)
        bindings.push(makeScriptBinding(statement.id.name, 'function', statement, baseOffset))

      if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations ?? []) {
          const name = declaration.id?.name
          if (name)
            bindings.push(makeScriptBinding(name, statement.kind === 'let' ? 'let' : 'const', declaration, baseOffset))
        }
      }
    }
  }
  catch {
    return bindings
  }

  return bindings
}

function makeScriptBinding(
  name: string,
  kind: RComponentSFC_AST_ScriptBinding['kind'],
  node: { start?: number | null, end?: number | null },
  baseOffset: number,
): RComponentSFC_AST_ScriptBinding {
  return {
    name,
    kind,
    range: {
      start: baseOffset + Number(node.start ?? 0),
      end: baseOffset + Number(node.end ?? node.start ?? 0),
    },
  }
}

function rangeFromLoc(loc: SourceLocation | undefined, baseOffset = 0): RComponentSFC_SourceRange {
  return {
    start: baseOffset + Number(loc?.start.offset ?? 0),
    end: baseOffset + Number(loc?.end.offset ?? loc?.start.offset ?? 0),
    startLine: loc?.start.line,
    startColumn: loc?.start.column,
    endLine: loc?.end.line,
    endColumn: loc?.end.column,
  }
}

function toParserDiagnostic(error: unknown): RComponentDiagnostic {
  const err = error as { message?: string, loc?: { start?: { offset?: number }, end?: { offset?: number } } }
  return {
    severity: 'error',
    code: 'sfc-parse-error',
    message: err.message ?? String(error),
    start: err.loc?.start?.offset,
    end: err.loc?.end?.offset,
  }
}
