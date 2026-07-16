import type { ChildNode, Container, Node, Rule, Root } from 'postcss'
import scss from 'postcss-scss'
import selectorParser from 'postcss-selector-parser'
import valueParser from 'postcss-value-parser'

import type {
  CompileEndgeCSSOptions,
  CompileEndgeCSSResult,
  EndgeStyleAttributeOperator,
  EndgeStyleCompoundSelector,
  EndgeStyleDeclaration,
  EndgeStyleDiagnostic,
  EndgeStyleRule,
  EndgeStyleRuleIndex,
  EndgeStyleScope,
  EndgeStyleSelector,
  EndgeStyleSelectorSegment,
  EndgeStyleSpecificity,
  EndgeStyleSupportCondition,
  EndgeStyleTheme,
  EndgeStyleValueToken,
} from '@/domain/types/style'

const DEFAULT_MAX_NESTED_SELECTORS = 256

function hashSource(source: string): string {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function sourceRange(node: Node) {
  const start = node.source?.start
  const end = node.source?.end
  if (!start)
    return undefined

  return {
    start: start.offset ?? 0,
    end: (end?.offset ?? start.offset ?? 0) + 1,
    line: start.line,
    column: start.column,
  }
}

function emptyCompound(): EndgeStyleCompoundSelector {
  return { ids: [], classes: [], attributes: [], pseudos: [] }
}

function addSpecificity(target: EndgeStyleSpecificity, source: EndgeStyleSpecificity): void {
  target.ids += source.ids
  target.classes += source.classes
  target.types += source.types
}

function compareSpecificity(left: EndgeStyleSpecificity, right: EndgeStyleSpecificity): number {
  return left.ids - right.ids || left.classes - right.classes || left.types - right.types
}

function parseSelectorNode(selectorNode: any): EndgeStyleSelector {
  const segments: EndgeStyleSelectorSegment[] = []
  let compound = emptyCompound()
  let pendingCombinator: EndgeStyleSelectorSegment['combinator'] = null
  const specificity: EndgeStyleSpecificity = { ids: 0, classes: 0, types: 0 }

  const flush = () => {
    const hasValues = compound.universal || compound.tag || compound.ids.length > 0
      || compound.classes.length > 0 || compound.attributes.length > 0 || compound.pseudos.length > 0
    if (!hasValues)
      return
    segments.push({ combinator: segments.length === 0 ? null : pendingCombinator ?? 'descendant', compound })
    compound = emptyCompound()
    pendingCombinator = null
  }

  selectorNode.each((node: any) => {
    if (node.type === 'combinator') {
      flush()
      const value = node.value.trim()
      pendingCombinator = value === '>' ? 'child' : value === '+' ? 'adjacent' : value === '~' ? 'sibling' : 'descendant'
      return
    }

    if (node.type === 'tag') {
      compound.tag = node.value
      specificity.types += 1
      return
    }
    if (node.type === 'universal') {
      compound.universal = true
      return
    }
    if (node.type === 'id') {
      compound.ids.push(node.value)
      specificity.ids += 1
      return
    }
    if (node.type === 'class') {
      compound.classes.push(node.value)
      specificity.classes += 1
      return
    }
    if (node.type === 'attribute') {
      compound.attributes.push({
        name: node.attribute,
        operator: (node.operator ?? 'exists') as EndgeStyleAttributeOperator,
        value: node.value,
        insensitive: node.insensitive,
      })
      specificity.classes += 1
      return
    }
    if (node.type !== 'pseudo')
      return

    const name = node.value.replace(/^:+/, '').toLowerCase()
    const argument = node.nodes?.map((child: any) => child.toString()).join(',').trim() ?? ''
    if (name === 'part' && node.value.startsWith('::')) {
      compound.pseudos.push({ name: 'part', value: argument, element: true })
      specificity.types += 1
      return
    }
    if (name === 'component' || name === 'identity' || name === 'state') {
      compound.pseudos.push({ name, value: argument })
      specificity.classes += 1
      return
    }
    if (name === 'first-child' || name === 'last-child') {
      compound.pseudos.push({ name })
      specificity.classes += 1
      return
    }
    if (name === 'nth-child') {
      compound.pseudos.push({ name, expression: argument })
      specificity.classes += 1
      return
    }
    if (name === 'not' || name === 'is' || name === 'where') {
      const selectors: EndgeStyleSelector[] = (node.nodes ?? []).map((child: any) => parseSelectorNode(child))
      compound.pseudos.push({ name, selectors })
      if (name !== 'where') {
        const maximum = selectors.reduce((current: EndgeStyleSpecificity, selector: EndgeStyleSelector) =>
          compareSpecificity(selector.specificity, current) > 0 ? selector.specificity : current,
        { ids: 0, classes: 0, types: 0 })
        addSpecificity(specificity, maximum)
      }
      return
    }

    throw new Error(`Unsupported pseudo selector :${name}`)
  })
  flush()

  return { source: selectorNode.toString(), segments, specificity }
}

export function parseEndgeStyleSelectorList(source: string): EndgeStyleSelector[] {
  const root = selectorParser().astSync(source)
  return root.nodes.map(selector => parseSelectorNode(selector))
}

function parseValueTokens(source: string): EndgeStyleValueToken[] {
  const convert = (node: any): EndgeStyleValueToken => ({
    type: node.type,
    value: node.value ?? node.toString(),
    nodes: node.nodes?.map(convert),
  })
  return valueParser(source).nodes.map(convert)
}

function parseDeclaration(node: any, diagnostics: EndgeStyleDiagnostic[]): EndgeStyleDeclaration | null {
  if (node.prop.startsWith('$')) {
    diagnostics.push({
      severity: 'error',
      code: 'ENDGECSS_SCSS_VARIABLE_UNSUPPORTED',
      message: 'SCSS $variables are not supported. Use CSS custom properties and var().',
      range: sourceRange(node),
    })
    return null
  }

  return {
    property: node.prop,
    value: node.value,
    valueTokens: parseValueTokens(node.value),
    important: Boolean(node.important),
    range: sourceRange(node),
  }
}

function splitTopLevelBoolean(source: string, operator: 'and' | 'or'): string[] {
  const result: string[] = []
  let depth = 0
  let start = 0
  const pattern = ` ${operator} `
  for (let index = 0; index <= source.length - pattern.length; index += 1) {
    if (source[index] === '(') depth += 1
    if (source[index] === ')') depth -= 1
    if (depth === 0 && source.slice(index, index + pattern.length).toLowerCase() === pattern) {
      result.push(source.slice(start, index).trim())
      start = index + pattern.length
      index = start - 1
    }
  }
  result.push(source.slice(start).trim())
  return result
}

function unwrapParentheses(source: string): string {
  let result = source.trim()
  while (result.startsWith('(') && result.endsWith(')')) {
    let depth = 0
    let wrapsWholeValue = true
    for (let index = 0; index < result.length; index += 1) {
      if (result[index] === '(') depth += 1
      if (result[index] === ')') depth -= 1
      if (depth === 0 && index < result.length - 1) {
        wrapsWholeValue = false
        break
      }
    }
    if (!wrapsWholeValue) break
    result = result.slice(1, -1).trim()
  }
  return result
}

export function parseEndgeStyleSupportCondition(source: string): EndgeStyleSupportCondition {
  const normalized = unwrapParentheses(source)
  const orParts = splitTopLevelBoolean(normalized, 'or')
  if (orParts.length > 1)
    return { type: 'or', operands: orParts.map(parseEndgeStyleSupportCondition) }
  const andParts = splitTopLevelBoolean(normalized, 'and')
  if (andParts.length > 1)
    return { type: 'and', operands: andParts.map(parseEndgeStyleSupportCondition) }
  if (/^not\s+/i.test(normalized))
    return { type: 'not', operand: parseEndgeStyleSupportCondition(normalized.replace(/^not\s+/i, '')) }
  const renderer = normalized.match(/^renderer\(\s*([\w-]+)\s*\)$/i)
  if (renderer)
    return { type: 'renderer', renderer: renderer[1] }
  const capability = normalized.match(/^capability\(\s*([\w-]+)\s*\)$/i)
  if (capability)
    return { type: 'capability', capability: capability[1] }
  throw new Error(`Expected renderer(name) or capability(name), received: ${source}`)
}

function parseScope(source: string): EndgeStyleScope {
  const match = source.trim().match(/^\((.+?)\)(?:\s+to\s+\((.+)\))?$/s)
  if (!match)
    throw new Error('Expected @scope (<selector>) or @scope (<selector>) to (<selector>)')
  return {
    root: parseEndgeStyleSelectorList(match[1]),
    limit: match[2] ? parseEndgeStyleSelectorList(match[2]) : undefined,
  }
}

function selectorsFromRule(rule: Rule): string[] {
  return selectorParser().astSync(rule.selector).nodes.map(selector => selector.toString())
}

function expandNestedSelectors(parents: string[], children: string[], maximum: number): string[] {
  if (parents.length === 0)
    return children
  if (parents.length * children.length > maximum)
    throw new Error(`Nested selector expansion exceeds the limit of ${maximum}`)
  const result: string[] = []
  for (const parent of parents) {
    for (const child of children)
      result.push(child.includes('&') ? child.replaceAll('&', parent) : `${parent} ${child}`)
  }
  return result
}

function createEmptyIndex(): EndgeStyleRuleIndex {
  return { universal: [], tags: {}, classes: {}, ids: {}, components: {}, identities: {}, states: {}, parts: {} }
}

function appendIndex(index: Record<string, string[]>, key: string, ruleId: string): void {
  const values = index[key] ?? (index[key] = [])
  if (!values.includes(ruleId)) values.push(ruleId)
}

function indexRules(rules: EndgeStyleRule[]): EndgeStyleRuleIndex {
  const index = createEmptyIndex()
  for (const rule of rules) {
    let indexed = false
    for (const selector of rule.selectors) {
      for (const segment of selector.segments) {
        const compound = segment.compound
        if (compound.tag) { appendIndex(index.tags, compound.tag, rule.id); indexed = true }
        for (const value of compound.classes) { appendIndex(index.classes, value, rule.id); indexed = true }
        for (const value of compound.ids) { appendIndex(index.ids, value, rule.id); indexed = true }
        for (const pseudo of compound.pseudos) {
          if (pseudo.name === 'component') { appendIndex(index.components, pseudo.value, rule.id); indexed = true }
          if (pseudo.name === 'identity') { appendIndex(index.identities, pseudo.value, rule.id); indexed = true }
          if (pseudo.name === 'state') { appendIndex(index.states, pseudo.value, rule.id); indexed = true }
          if (pseudo.name === 'part') { appendIndex(index.parts, pseudo.value, rule.id); indexed = true }
        }
      }
    }
    if (!indexed) index.universal.push(rule.id)
  }
  return index
}

export function compileEndgeCSS(source: string, options: CompileEndgeCSSOptions = {}): CompileEndgeCSSResult {
  const diagnostics: EndgeStyleDiagnostic[] = []
  const rules: EndgeStyleRule[] = []
  const themes: EndgeStyleTheme[] = []
  const maximum = options.maxNestedSelectors ?? DEFAULT_MAX_NESTED_SELECTORS
  let root: Root

  try {
    root = scss.parse(source)
  }
  catch (error: any) {
    diagnostics.push({
      severity: 'error',
      code: 'ENDGECSS_SYNTAX',
      message: error.reason ?? error.message ?? String(error),
      range: error.line ? { start: error.input?.column ?? 0, end: error.input?.column ?? 0, line: error.line, column: error.column } : undefined,
    })
    return { ast: null, artifact: null, diagnostics }
  }

  const visit = (
    container: Container,
    parentSelectors: string[] = [],
    context: { theme?: string, scope?: EndgeStyleScope, supports?: EndgeStyleSupportCondition } = {},
  ) => {
    for (const node of container.nodes ?? []) {
      if (node.type === 'comment' || node.type === 'decl')
        continue

      if (node.type === 'rule') {
        try {
          const expanded = expandNestedSelectors(parentSelectors, selectorsFromRule(node), maximum)
          const declarations = (node.nodes ?? [])
            .filter(child => child.type === 'decl')
            .map(child => parseDeclaration(child, diagnostics))
            .filter((declaration): declaration is EndgeStyleDeclaration => declaration !== null)
          if (expanded.some(selector => selector.includes('::slot('))) {
            diagnostics.push({ severity: 'error', code: 'ENDGECSS_SLOT_RESERVED', message: '::slot() is reserved for a future structural slot contract.', range: sourceRange(node) })
          }
          if (declarations.length > 0) {
            const selectors = parseEndgeStyleSelectorList(expanded.join(', '))
            const order = rules.length
            rules.push({
              id: `es-${hashSource(`${options.identity ?? 'style'}:${order}:${expanded.join(',')}`)}`,
              selectors,
              declarations,
              theme: context.theme,
              scope: context.scope,
              supports: context.supports,
              sourceOrder: order,
              range: sourceRange(node),
            })
          }
          visit(node, expanded, context)
        }
        catch (error: any) {
          diagnostics.push({ severity: 'error', code: 'ENDGECSS_SELECTOR', message: error.message ?? String(error), range: sourceRange(node) })
        }
        continue
      }

      if (node.type !== 'atrule')
        continue
      const name = node.name.toLowerCase()
      if (name === 'layer') {
        diagnostics.push({
          severity: 'error',
          code: 'ENDGECSS_LAYER_FORBIDDEN',
          message: '@layer is not part of EndgeCSS. Source selection and Specific Override bindings are separate from stylesheet cascade layers.',
          range: sourceRange(node),
        })
        continue
      }
      if (name === 'theme') {
        const id = node.params.trim()
        if (!id || !/^[a-zA-Z][\w-]*$/.test(id)) {
          diagnostics.push({ severity: 'error', code: 'ENDGECSS_THEME_ID', message: '@theme requires a stable identifier.', range: sourceRange(node) })
          continue
        }
        const declarations = (node.nodes ?? [])
          .filter(child => child.type === 'decl')
          .map(child => parseDeclaration(child, diagnostics))
          .filter((declaration): declaration is EndgeStyleDeclaration => declaration !== null)
        const existing = themes.find(theme => theme.id === id)
        if (existing) existing.declarations.push(...declarations)
        else themes.push({ id, declarations, range: sourceRange(node) })
        visit(node, parentSelectors, { ...context, theme: id })
        continue
      }
      if (name === 'scope') {
        try {
          visit(node, parentSelectors, { ...context, scope: parseScope(node.params) })
        }
        catch (error: any) {
          diagnostics.push({ severity: 'error', code: 'ENDGECSS_SCOPE', message: error.message ?? String(error), range: sourceRange(node) })
        }
        continue
      }
      if (name === 'supports') {
        try {
          visit(node, parentSelectors, { ...context, supports: parseEndgeStyleSupportCondition(node.params) })
        }
        catch (error: any) {
          diagnostics.push({ severity: 'error', code: 'ENDGECSS_SUPPORTS', message: error.message ?? String(error), range: sourceRange(node) })
        }
        continue
      }
      diagnostics.push({ severity: 'error', code: 'ENDGECSS_AT_RULE_UNSUPPORTED', message: `@${node.name} is not supported by EndgeCSS.`, range: sourceRange(node) })
    }
  }

  visit(root)
  const identity = options.identity ?? 'anonymous-style'
  const artifact = diagnostics.some(diagnostic => diagnostic.severity === 'error')
    ? null
    : {
        language: 'endgecss' as const,
        version: 1 as const,
        identity,
        sourceHash: hashSource(source),
        scope: options.scope ?? 'global' as const,
        scopeId: options.scopeId,
        rules,
        themes,
        indexes: indexRules(rules),
      }

  return {
    ast: { type: 'stylesheet', source, nodes: root.nodes as ChildNode[] },
    artifact,
    diagnostics,
  }
}
