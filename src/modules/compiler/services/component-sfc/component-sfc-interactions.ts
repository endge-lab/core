import type { RComponentDependencies, RComponentDiagnostic } from '@/modules/domain/types/component/component-core.types'

import type { RComponentSFC_AST_Attribute } from '@/modules/domain/types/component/sfc/ast.types'
import type {
  RComponentSFC_IR_EventModifier,
  RComponentSFC_IR_InteractionGroup,
  RComponentSFC_IR_InteractionRule,
} from '@/modules/domain/types/component/sfc/ir.types'
import type { ComponentSFCPortManifest } from '@/modules/domain/types/component/sfc/ports.types'
import { parseExpression } from '@babel/parser'
import { compileComponentSFCExpression } from '@/modules/compiler/services/component-sfc/component-sfc-expression'
import { compileComponentSFCLocalEventAction } from '@/modules/compiler/services/component-sfc/component-sfc-ports'

const INTERACTION_MODIFIERS = new Set<RComponentSFC_IR_EventModifier>([
  'stop',
  'prevent',
  'self',
  'once',
  'capture',
  'passive',
])
const TRIGGER_KEYS = new Set([
  'event',
  'key',
  'code',
  'held',
  'modifiers',
  'repeat',
  'composing',
  'button',
  'stop',
  'prevent',
  'self',
  'once',
  'capture',
  'passive',
  'reaction',
])
const TRIGGER_SET_KEYS = new Set(['triggers', 'reaction'])

export interface ComponentSFCInteractionCompileContext {
  props: string[]
  locals: string[]
}

/** Detects statically invalid passive/prevent combinations in shared trigger descriptors. */
export function hasComponentSFCPassivePreventConflict(
  source: string,
  suffixes: readonly RComponentSFC_IR_EventModifier[] = [],
): boolean {
  try {
    const expression: any = parseExpression(String(source ?? '').trim(), { sourceType: 'module', plugins: ['typescript'] })
    const nodes = expression.type === 'ArrayExpression' ? expression.elements : [expression]
    return nodes.some((node: any) => {
      if (node?.type !== 'ObjectExpression') {
        return false
      }
      const properties = new Map<string, any>()
      for (const property of node.properties ?? []) {
        const name = propertyName(property)
        if (name) {
          properties.set(name, property)
        }
      }
      const passive = suffixes.includes('passive') || booleanProperty(properties.get('passive')) === true
      const prevent = suffixes.includes('prevent') || booleanProperty(properties.get('prevent')) === true
      return passive && prevent
    })
  }
  catch {
    return false
  }
}

/** Compiles one source-owned `:on` annotation into renderer-neutral rules. */
export function compileComponentSFCInteractionAnnotation(
  attribute: RComponentSFC_AST_Attribute,
  manifest: ComponentSFCPortManifest | null,
  context: ComponentSFCInteractionCompileContext,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
  ownerPorts?: ComponentSFCPortManifest | null,
): RComponentSFC_IR_InteractionGroup | null {
  const source = String(attribute.value ?? '').trim()
  if (!attribute.dynamic || !source) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-dynamic', ':on требует динамический object или array binding.')
    return null
  }

  const suffixes: RComponentSFC_IR_EventModifier[] = []
  let invalid = false
  for (const modifier of attribute.modifiers) {
    if (!INTERACTION_MODIFIERS.has(modifier as RComponentSFC_IR_EventModifier)) {
      pushDiagnostic(diagnostics, attribute, 'sfc-template-on-modifier', `:on не поддерживает modifier ".${modifier}".`)
      invalid = true
      continue
    }
    if (!suffixes.includes(modifier as RComponentSFC_IR_EventModifier)) {
      suffixes.push(modifier as RComponentSFC_IR_EventModifier)
    }
  }
  if (suffixes.includes('passive') && suffixes.includes('prevent')) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-passive-prevent', ':on.passive нельзя объединять с .prevent.')
    invalid = true
  }

  let expression: any
  try {
    expression = parseExpression(source, { sourceType: 'module', plugins: ['typescript'] })
  }
  catch (error: any) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-syntax', `Не удалось разобрать :on: ${error?.message ?? error}`)
    return null
  }

  if (isTriggerSetRule(expression)) {
    return compileTriggerSetRule(
      expression,
      source,
      suffixes,
      attribute,
      manifest,
      context,
      dependencies,
      diagnostics,
      ownerPorts,
    )
  }

  const nodes = expression.type === 'ArrayExpression' ? expression.elements : [expression]
  if (nodes.length === 0) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-empty', ':on требует хотя бы одно правило.')
    return null
  }

  const rules: RComponentSFC_IR_InteractionRule[] = []
  for (const node of nodes) {
    const rule = compileRule(node, source, suffixes, attribute, manifest, context, dependencies, diagnostics, ownerPorts)
    if (rule) {
      rules.push(rule)
    }
    else { invalid = true }
  }
  if (invalid || rules.length === 0) {
    return null
  }
  return { rules, sourceRange: attribute.range }
}

/** Compiles `{ triggers, reaction }` by retaining one runtime TriggerSet expression. */
function compileTriggerSetRule(
  node: any,
  source: string,
  suffixes: RComponentSFC_IR_EventModifier[],
  attribute: RComponentSFC_AST_Attribute,
  manifest: ComponentSFCPortManifest | null,
  context: ComponentSFCInteractionCompileContext,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
  ownerPorts?: ComponentSFCPortManifest | null,
): RComponentSFC_IR_InteractionGroup | null {
  const properties = node.properties ?? []
  if (properties.some((property: any) => property?.type !== 'ObjectProperty' || property.computed)) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-trigger-set-shape', 'Ссылочная форма :on не поддерживает spread, methods и computed properties.')
    return null
  }

  const byName = new Map<string, any>()
  for (const property of properties) {
    const name = propertyName(property)
    if (!name || !TRIGGER_SET_KEYS.has(name) || byName.has(name)) {
      pushDiagnostic(diagnostics, attribute, 'sfc-template-on-trigger-set-property', `Ссылочная форма :on содержит недопустимое или повторное поле "${name || '<computed>'}".`)
      return null
    }
    byName.set(name, property)
  }

  const triggersNode = byName.get('triggers')?.value
  if (!triggersNode) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-triggers-missing', 'Ссылочная форма :on требует поле triggers.')
    return null
  }
  const reactionNode = byName.get('reaction')?.value
  if (!reactionNode) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-reaction-missing', 'Ссылочная форма :on требует reaction.')
    return null
  }

  const trigger = compileComponentSFCExpression(sliceNode(source, triggersNode), {
    props: context.props,
    locals: context.locals,
    sourcePath: 'template.on.triggers',
  })
  diagnostics.push(...trigger.diagnostics)

  const eventNames = [...new Set(manifest?.emits.events.map(event => event.name).filter(Boolean) ?? [])]
  if (eventNames.length === 0) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-event-unknown', 'Тег не имеет event-поверхности для ссылочного TriggerSet.')
    return null
  }

  const reactionNodes = reactionNode.type === 'ArrayExpression' ? reactionNode.elements : [reactionNode]
  if (reactionNodes.length === 0 || reactionNodes.some((item: any) => !item || item.type === 'SpreadElement')) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-reaction-shape', 'reaction требует одну реакцию или непустой массив реакций.')
    return null
  }
  const reactions = reactionNodes.flatMap((item: any) => {
    const reactionSource = sliceNode(source, item)
    const compiled = compileComponentSFCLocalEventAction(
      eventNames[0]!,
      reactionSource,
      attribute.range.start + (item.start ?? 0),
      dependencies,
      diagnostics,
      ownerPorts,
    )
    return compiled ? [compiled] : []
  })
  if (reactions.length !== reactionNodes.length) {
    return null
  }

  const sourceRange = {
    start: attribute.range.start + (node.start ?? 0),
    end: attribute.range.start + (node.end ?? source.length),
  }
  return {
    rules: [],
    triggerSet: {
      triggers: trigger.value,
      events: eventNames,
      modifiers: suffixes,
      reactions,
      sourceRange,
    },
    sourceRange: attribute.range,
  }
}

function isTriggerSetRule(node: any): boolean {
  if (node?.type !== 'ObjectExpression') {
    return false
  }
  return (node.properties ?? []).some((property: any) => propertyName(property) === 'triggers')
}

function compileRule(
  node: any,
  source: string,
  suffixes: RComponentSFC_IR_EventModifier[],
  attribute: RComponentSFC_AST_Attribute,
  manifest: ComponentSFCPortManifest | null,
  context: ComponentSFCInteractionCompileContext,
  dependencies: RComponentDependencies,
  diagnostics: RComponentDiagnostic[],
  ownerPorts?: ComponentSFCPortManifest | null,
): RComponentSFC_IR_InteractionRule | null {
  if (!node || node.type !== 'ObjectExpression') {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-rule-shape', 'Каждое правило :on должно быть object literal.')
    return null
  }
  const properties = node.properties ?? []
  if (properties.some((property: any) => property?.type !== 'ObjectProperty' || property.computed)) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-rule-shape', ':on не поддерживает spread, methods и computed properties.')
    return null
  }

  const byName = new Map<string, any>()
  for (const property of properties) {
    const name = propertyName(property)
    if (!name || !TRIGGER_KEYS.has(name)) {
      pushDiagnostic(diagnostics, attribute, 'sfc-template-on-rule-property', `Неизвестное поле правила :on: ${name || '<computed>'}.`)
      return null
    }
    if (byName.has(name)) {
      pushDiagnostic(diagnostics, attribute, 'sfc-template-on-rule-property', `Поле :on.${name} объявлено повторно.`)
      return null
    }
    byName.set(name, property)
  }

  const event = literalString(byName.get('event')?.value)
  if (!event) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-event-static', 'Каждое правило :on требует static строковое поле event.')
    return null
  }
  if (!manifest?.emits.events.some(candidate => candidate.name === event)) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-event-unknown', `Event "${event}" не объявлен source-тегом или тег не имеет event-поверхности.`)
    return null
  }

  const reaction = byName.get('reaction')?.value
  if (!reaction) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-reaction-missing', `Правило :on для "${event}" требует reaction.`)
    return null
  }
  const reactionNodes = reaction.type === 'ArrayExpression' ? reaction.elements : [reaction]
  if (reactionNodes.length === 0 || reactionNodes.some((item: any) => !item || item.type === 'SpreadElement')) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-reaction-shape', 'reaction требует одну реакцию или непустой массив реакций.')
    return null
  }

  const reactions = reactionNodes.flatMap((item: any) => {
    const reactionSource = sliceNode(source, item)
    const compiled = compileComponentSFCLocalEventAction(
      event,
      reactionSource,
      attribute.range.start + (item.start ?? 0),
      dependencies,
      diagnostics,
      ownerPorts,
    )
    return compiled ? [compiled] : []
  })
  if (reactions.length !== reactionNodes.length) {
    return null
  }

  const triggerProperties = properties.filter((property: any) => propertyName(property) !== 'reaction')
  const triggerSource = `{ ${triggerProperties.map((property: any) => sliceNode(source, property)).join(', ')} }`
  const trigger = compileComponentSFCExpression(triggerSource, {
    props: context.props,
    locals: context.locals,
    sourcePath: `template.on.${event}`,
  })
  diagnostics.push(...trigger.diagnostics)

  const capture = booleanProperty(byName.get('capture'))
  const passive = booleanProperty(byName.get('passive'))
  if (capture === null || passive === null) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-listener-static', 'Поля capture и passive должны быть static boolean, так как определяют native listener.')
    return null
  }
  const effectiveCapture = suffixes.includes('capture') || capture === true
  const effectivePassive = suffixes.includes('passive') || passive === true
  const prevent = booleanProperty(byName.get('prevent'))
  const effectivePrevent = suffixes.includes('prevent') || prevent === true
  if (effectivePassive && prevent === null) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-passive-prevent', `Правило :on для "${event}" с passive требует static boolean поле prevent.`)
    return null
  }
  if (effectivePassive && effectivePrevent) {
    pushDiagnostic(diagnostics, attribute, 'sfc-template-on-passive-prevent', `Правило :on для "${event}" не может одновременно использовать passive и prevent.`)
    return null
  }

  return {
    event,
    trigger: trigger.value,
    modifiers: suffixes,
    listener: { capture: effectiveCapture, passive: effectivePassive },
    reactions,
    sourceRange: {
      start: attribute.range.start + (node.start ?? 0),
      end: attribute.range.start + (node.end ?? source.length),
    },
  }
}

function propertyName(property: any): string | null {
  if (property?.key?.type === 'Identifier') {
    return property.key.name
  }
  if (property?.key?.type === 'StringLiteral') {
    return String(property.key.value)
  }
  return null
}

function literalString(node: any): string | null {
  if (node?.type === 'StringLiteral') {
    return String(node.value ?? '').trim() || null
  }
  if (node?.type === 'TemplateLiteral' && node.expressions?.length === 0) {
    return String(node.quasis?.[0]?.value?.cooked ?? '').trim() || null
  }
  return null
}

/** undefined means absent, null means present but not static boolean. */
function booleanProperty(property: any): boolean | null | undefined {
  if (!property) {
    return undefined
  }
  return property.value?.type === 'BooleanLiteral' ? property.value.value === true : null
}

function sliceNode(source: string, node: any): string {
  return source.slice(node.start ?? 0, node.end ?? source.length)
}

function pushDiagnostic(
  diagnostics: RComponentDiagnostic[],
  attribute: RComponentSFC_AST_Attribute,
  code: string,
  message: string,
): void {
  diagnostics.push({
    severity: 'error',
    code,
    message,
    sourcePath: 'template.on',
    start: attribute.range.start,
    end: attribute.range.end,
  })
}
