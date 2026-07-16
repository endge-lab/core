import type {
  EndgeStyleAttributeSelector,
  EndgeStyleCompoundSelector,
  EndgeStyleMatchNode,
  EndgeStyleResolvedDeclaration,
  EndgeStyleRule,
  EndgeStyleSelector,
  EndgeStyleSheetArtifact,
  EndgeStyleSpecificity,
  EndgeStyleSupportCondition,
  EndgeStyleTargetProfile,
} from '@/domain/types/style'

function attributeMatches(selector: EndgeStyleAttributeSelector, node: EndgeStyleMatchNode): boolean {
  const raw = selector.name === 'part'
    ? [...node.parts].join(' ')
    : node.attributes[selector.name]
  if (selector.operator === 'exists')
    return raw !== undefined && raw !== false && raw !== null
  if (raw === undefined || raw === null)
    return false
  const actual = String(raw)
  const expected = selector.value ?? ''
  const left = selector.insensitive ? actual.toLowerCase() : actual
  const right = selector.insensitive ? expected.toLowerCase() : expected
  if (selector.operator === '=') return left === right
  if (selector.operator === '~=') return left.split(/\s+/).includes(right)
  if (selector.operator === '|=') return left === right || left.startsWith(`${right}-`)
  if (selector.operator === '^=') return left.startsWith(right)
  if (selector.operator === '$=') return left.endsWith(right)
  return left.includes(right)
}

function nthMatches(expression: string, index: number): boolean {
  const normalized = expression.replace(/\s+/g, '').toLowerCase()
  if (normalized === 'odd') return index % 2 === 1
  if (normalized === 'even') return index % 2 === 0
  if (/^[+-]?\d+$/.test(normalized)) return index === Number(normalized)
  const match = normalized.match(/^([+-]?\d*)n([+-]\d+)?$/)
  if (!match) return false
  const coefficient = match[1] === '' || match[1] === '+' ? 1 : match[1] === '-' ? -1 : Number(match[1])
  const offset = Number(match[2] ?? 0)
  if (coefficient === 0) return index === offset
  const step = (index - offset) / coefficient
  return Number.isInteger(step) && step >= 0
}

function compoundMatches(compound: EndgeStyleCompoundSelector, node: EndgeStyleMatchNode): boolean {
  if (compound.tag && compound.tag !== node.tag)
    return false
  if (compound.ids.some(id => id !== node.id))
    return false
  if (compound.classes.some(className => !node.classes.has(className)))
    return false
  if (compound.attributes.some(attribute => !attributeMatches(attribute, node)))
    return false

  return compound.pseudos.every((pseudo) => {
    if (pseudo.name === 'first-child') return node.index === 1
    if (pseudo.name === 'last-child') return node.index === node.siblingCount
    if (pseudo.name === 'nth-child') return nthMatches(pseudo.expression, node.index)
    if (pseudo.name === 'component') return node.component === pseudo.value
    if (pseudo.name === 'identity') return node.identity === pseudo.value
    if (pseudo.name === 'state') return node.states.has(pseudo.value)
    if (pseudo.name === 'part') return node.parts.has(pseudo.value)
    if (pseudo.name === 'not') return !pseudo.selectors.some(selector => matchEndgeStyleSelector(selector, node))
    if (pseudo.name === 'is' || pseudo.name === 'where')
      return pseudo.selectors.some(selector => matchEndgeStyleSelector(selector, node))
    return false
  })
}

function previousSibling(node: EndgeStyleMatchNode): EndgeStyleMatchNode | undefined {
  return node.previousSiblings?.at(-1)
}

function matchSegment(selector: EndgeStyleSelector, segmentIndex: number, node: EndgeStyleMatchNode | undefined): boolean {
  if (!node || !compoundMatches(selector.segments[segmentIndex].compound, node))
    return false
  if (segmentIndex === 0)
    return true

  const combinator = selector.segments[segmentIndex].combinator
  if (combinator === 'child')
    return matchSegment(selector, segmentIndex - 1, node.parent)
  if (combinator === 'adjacent')
    return matchSegment(selector, segmentIndex - 1, previousSibling(node))
  if (combinator === 'sibling')
    return (node.previousSiblings ?? []).some(sibling => matchSegment(selector, segmentIndex - 1, sibling))

  let ancestor = node.parent
  while (ancestor) {
    if (matchSegment(selector, segmentIndex - 1, ancestor))
      return true
    ancestor = ancestor.parent
  }
  return false
}

export function matchEndgeStyleSelector(selector: EndgeStyleSelector, node: EndgeStyleMatchNode): boolean {
  if (selector.segments.length === 0)
    return false
  return matchSegment(selector, selector.segments.length - 1, node)
}

export function evaluateEndgeStyleSupport(
  condition: EndgeStyleSupportCondition | undefined,
  target: EndgeStyleTargetProfile,
): boolean {
  if (!condition) return true
  if (condition.type === 'renderer') return condition.renderer === target.renderer
  if (condition.type === 'capability') return new Set(target.capabilities ?? []).has(condition.capability)
  if (condition.type === 'not') return !evaluateEndgeStyleSupport(condition.operand, target)
  if (condition.type === 'and') return condition.operands.every(operand => evaluateEndgeStyleSupport(operand, target))
  return condition.operands.some(operand => evaluateEndgeStyleSupport(operand, target))
}

function matchesScope(rule: EndgeStyleRule, node: EndgeStyleMatchNode): boolean {
  if (!rule.scope) return true
  let current: EndgeStyleMatchNode | undefined = node
  let root: EndgeStyleMatchNode | undefined
  while (current) {
    const candidate = current
    if (rule.scope.root.some(selector => matchEndgeStyleSelector(selector, candidate))) {
      root = candidate
      break
    }
    current = current.parent
  }
  if (!root) return false
  if (!rule.scope.limit) return true
  current = node
  while (current && current !== root) {
    const candidate = current
    if (rule.scope.limit.some(selector => matchEndgeStyleSelector(selector, candidate)))
      return false
    current = current.parent
  }
  return true
}

export function matchEndgeStyleRule(
  artifact: EndgeStyleSheetArtifact,
  rule: EndgeStyleRule,
  node: EndgeStyleMatchNode,
  target: EndgeStyleTargetProfile,
  theme?: string,
): EndgeStyleSelector[] {
  if (rule.theme && rule.theme !== theme) return []
  if (!evaluateEndgeStyleSupport(rule.supports, target)) return []
  if (artifact.scope === 'component' && artifact.scopeId && node.ownerScopeId !== artifact.scopeId) {
    const exposesPart = rule.selectors.some(selector => selector.segments.at(-1)?.compound.pseudos.some(pseudo => pseudo.name === 'part'))
    if (!exposesPart) return []
  }
  if (!matchesScope(rule, node)) return []
  return rule.selectors.filter(selector => matchEndgeStyleSelector(selector, node))
}

function compareSpecificity(left: EndgeStyleSpecificity, right: EndgeStyleSpecificity): number {
  return left.ids - right.ids || left.classes - right.classes || left.types - right.types
}

export function resolveEndgeStyleDeclarations(
  artifacts: readonly EndgeStyleSheetArtifact[],
  node: EndgeStyleMatchNode,
  target: EndgeStyleTargetProfile,
  theme?: string,
): Record<string, EndgeStyleResolvedDeclaration> {
  const resolved: Record<string, EndgeStyleResolvedDeclaration> = {}
  artifacts.forEach((artifact, artifactOrder) => {
    artifact.rules.forEach((rule) => {
      const selectors = matchEndgeStyleRule(artifact, rule, node, target, theme)
      for (const selector of selectors) {
        for (const declaration of rule.declarations) {
          const candidate: EndgeStyleResolvedDeclaration = {
            ...declaration,
            ruleId: rule.id,
            specificity: selector.specificity,
            sourceOrder: artifactOrder * 1_000_000 + rule.sourceOrder,
          }
          const previous = resolved[declaration.property]
          const wins = !previous
            || Number(candidate.important) > Number(previous.important)
            || (candidate.important === previous.important && compareSpecificity(candidate.specificity, previous.specificity) > 0)
            || (candidate.important === previous.important
              && compareSpecificity(candidate.specificity, previous.specificity) === 0
              && candidate.sourceOrder >= previous.sourceOrder)
          if (wins) resolved[declaration.property] = candidate
        }
      }
    })
  })
  return resolved
}
