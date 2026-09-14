import type * as t from '@babel/types'
import type { ComponentSFCExpressionIR } from '@/features/core/modules/domain/types/component/sfc/expression-ir.types'

/** Lowering уже разобранного AST; parser вызывается только владельцем compile pipeline. */
export function lowerComponentSFCExpression(node: t.Node): ComponentSFCExpressionIR {
  const lower = lowerComponentSFCExpression
  switch (node.type) {
    case 'NumericLiteral':
      return Number.isFinite(node.value) ? { kind: 'literal', value: node.value } : { kind: 'read', name: 'Infinity' }
    case 'StringLiteral': case 'BooleanLiteral':
      return { kind: 'literal', value: node.value }
    case 'NullLiteral': return { kind: 'literal', value: null }
    case 'Identifier': return { kind: 'read', name: node.name }
    case 'ParenthesizedExpression': case 'TSAsExpression': case 'TSTypeAssertion': case 'TSNonNullExpression':
      return lower(node.expression)
    case 'UnaryExpression': return { kind: 'unary', operator: node.operator, argument: lower(node.argument) }
    case 'BinaryExpression': case 'LogicalExpression':
      return { kind: node.type === 'BinaryExpression' ? 'binary' : 'logical', operator: node.operator, left: lower(node.left), right: lower(node.right) }
    case 'ConditionalExpression':
      return { kind: 'conditional', test: lower(node.test), consequent: lower(node.consequent), alternate: lower(node.alternate) }
    case 'MemberExpression': case 'OptionalMemberExpression': {
      const property = node.property
      if (node.computed && property.type === 'AssignmentExpression' && property.operator === '=' && property.left.type === 'Identifier') {
        return { kind: 'select', object: lower(node.object), key: property.left.name, value: lower(property.right) }
      }
      return { kind: 'member', object: lower(node.object), property: lower(property), computed: node.computed }
    }
    case 'CallExpression': case 'OptionalCallExpression':
      return { kind: 'call', callee: lower(node.callee), arguments: node.arguments.map(lower) }
    case 'ArrayExpression':
      return { kind: 'array', items: node.elements.map(item => item ? lower(item) : { kind: 'read', name: 'undefined' }) }
    case 'ObjectExpression': {
      const entries: Array<{ key: string, value: ComponentSFCExpressionIR }> = []
      for (const property of node.properties) {
        if (property.type !== 'ObjectProperty' || property.computed) {
          return { kind: 'unsupported', reason: 'object-property' }
        }
        const key = property.key
        if (key.type !== 'Identifier' && key.type !== 'StringLiteral' && key.type !== 'NumericLiteral') {
          return { kind: 'unsupported' }
        }
        entries.push({ key: key.type === 'Identifier' ? key.name : String(key.value), value: lower(property.value) })
      }
      return { kind: 'object', entries }
    }
    case 'TemplateLiteral':
      return { kind: 'template', parts: node.quasis.map(part => part.value.cooked ?? part.value.raw), expressions: node.expressions.map(lower) }
    default: return { kind: 'unsupported' }
  }
}
