export interface EndgeStyleSourceRange {
  start: number
  end: number
  line: number
  column: number
}

export interface EndgeStyleDiagnostic {
  severity: 'info' | 'warning' | 'error'
  code: string
  message: string
  range?: EndgeStyleSourceRange
}

export interface EndgeStyleSpecificity {
  ids: number
  classes: number
  types: number
}

export type EndgeStyleCombinator = 'descendant' | 'child' | 'adjacent' | 'sibling'

export type EndgeStyleAttributeOperator = 'exists' | '=' | '~=' | '|=' | '^=' | '$=' | '*='

export interface EndgeStyleAttributeSelector {
  name: string
  operator: EndgeStyleAttributeOperator
  value?: string
  insensitive?: boolean
}

export type EndgeStylePseudoSelector
  = { name: 'first-child' | 'last-child' }
    | { name: 'nth-child', expression: string }
    | { name: 'component' | 'identity' | 'state', value: string }
    | { name: 'not' | 'is' | 'where', selectors: EndgeStyleSelector[] }
    | { name: 'part', value: string, element: true }

export interface EndgeStyleCompoundSelector {
  tag?: string
  universal?: boolean
  ids: string[]
  classes: string[]
  attributes: EndgeStyleAttributeSelector[]
  pseudos: EndgeStylePseudoSelector[]
}

export interface EndgeStyleSelectorSegment {
  combinator: EndgeStyleCombinator | null
  compound: EndgeStyleCompoundSelector
}

/** Selector is stored left-to-right. The matcher evaluates it right-to-left. */
export interface EndgeStyleSelector {
  source: string
  segments: EndgeStyleSelectorSegment[]
  specificity: EndgeStyleSpecificity
}

export interface EndgeStyleValueToken {
  type: 'word' | 'string' | 'space' | 'divider' | 'function' | 'comment'
  value: string
  nodes?: EndgeStyleValueToken[]
}

export interface EndgeStyleDeclaration {
  property: string
  value: string
  valueTokens: EndgeStyleValueToken[]
  important: boolean
  range?: EndgeStyleSourceRange
}

export type EndgeStyleSupportCondition
  = { type: 'renderer', renderer: string }
    | { type: 'capability', capability: string }
    | { type: 'not', operand: EndgeStyleSupportCondition }
    | { type: 'and' | 'or', operands: EndgeStyleSupportCondition[] }

export interface EndgeStyleScope {
  root: EndgeStyleSelector[]
  limit?: EndgeStyleSelector[]
}

export interface EndgeStyleRule {
  id: string
  selectors: EndgeStyleSelector[]
  declarations: EndgeStyleDeclaration[]
  theme?: string
  scope?: EndgeStyleScope
  supports?: EndgeStyleSupportCondition
  sourceOrder: number
  range?: EndgeStyleSourceRange
}

export interface EndgeStyleTheme {
  id: string
  declarations: EndgeStyleDeclaration[]
  range?: EndgeStyleSourceRange
}

export interface EndgeStyleRuleIndex {
  universal: string[]
  tags: Record<string, string[]>
  classes: Record<string, string[]>
  ids: Record<string, string[]>
  components: Record<string, string[]>
  identities: Record<string, string[]>
  states: Record<string, string[]>
  parts: Record<string, string[]>
}

export interface EndgeStyleSheetArtifact {
  language: 'endgecss'
  version: 1
  identity: string
  sourceHash: string
  scope: 'global' | 'component'
  scopeId?: string
  rules: EndgeStyleRule[]
  themes: EndgeStyleTheme[]
  indexes: EndgeStyleRuleIndex
}

export interface EndgeStyleAst {
  type: 'stylesheet'
  source: string
  nodes: unknown[]
}

export interface CompileEndgeCSSOptions {
  identity?: string
  scope?: 'global' | 'component'
  scopeId?: string
  maxNestedSelectors?: number
}

export interface CompileEndgeCSSResult {
  ast: EndgeStyleAst | null
  artifact: EndgeStyleSheetArtifact | null
  diagnostics: EndgeStyleDiagnostic[]
}

export interface EndgeStyleTargetProfile {
  renderer: string
  capabilities?: Iterable<string>
}

/** Renderer-neutral logical node. DOM wrappers are intentionally absent. */
export interface EndgeStyleMatchNode {
  tag: string
  id?: string
  classes: ReadonlySet<string>
  attributes: Readonly<Record<string, unknown>>
  states: ReadonlySet<string>
  parts: ReadonlySet<string>
  component?: string
  identity?: string
  ownerScopeId?: string
  parent?: EndgeStyleMatchNode
  previousSiblings?: readonly EndgeStyleMatchNode[]
  index: number
  siblingCount: number
}

export interface EndgeStyleResolvedDeclaration extends EndgeStyleDeclaration {
  ruleId: string
  specificity: EndgeStyleSpecificity
  sourceOrder: number
}
