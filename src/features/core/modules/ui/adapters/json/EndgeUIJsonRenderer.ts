import type {
  ComponentSFCInteractionTrigger,
  ComponentSFCInteractionTriggerEvent,
  ComponentSFCTableMenuDescriptor,
  RComponentSFC_IR,
  RComponentSFC_IR_ElementNode,
  RComponentSFC_IR_EventBinding,
  RComponentSFC_IR_EventModifier,
  RComponentSFC_IR_InteractionRule,
  RComponentSFC_IR_Node,
  RComponentSFC_IR_Value,
} from '@/features/core/modules/domain/types/component/sfc/ir.types'
import type {
  ComponentSFCEventRuntimeSource,
  ComponentSFCRequiredPortBinding,
} from '@/features/core/modules/domain/types/component/sfc/ports.types'
import type { ComponentSFCProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { ComponentSFCRenderPort } from '@/features/core/modules/runtime/domain/component-sfc-render-port.types'
import type { EndgeStyleMatchNode, EndgeStyleSheetArtifact } from '@/features/core/modules/styles/domain/types/style.types'
import type {
  EndgeUIEditableState,
  EndgeUIJsonSnapshot,
  EndgeUIJsonValue,
  EndgeUIMarker,
  EndgeUIMenu,
  EndgeUINode,
  EndgeUITableColumn,
} from '@/features/core/modules/ui/domain/types/endge-ui-json.types'

import { Endge } from '@/features/core/kernel/endge'
import {
  matchesComponentSFCInteractionTrigger,
  normalizeComponentSFCInteractionTriggers,
} from '@/features/core/modules/domain/component/component-sfc-edit-trigger'
import { getComponentSFCIntrinsicEventDefinitions } from '@/features/core/modules/domain/types/component/sfc/intrinsic-events.types'
import { ComponentSFCEventBoundary } from '@/features/core/modules/runtime/ComponentSFCEventBoundary'
import { evaluateComponentSFCExpression } from '@/features/core/modules/runtime/services/component-sfc-expression-evaluate'
import { readValuePath } from '@/features/core/modules/source/services/value-path'
import { resolveEndgeStyleDeclarations } from '@/features/core/modules/styles/services/endgecss-match'
import { ENDGE_UI_JSON_FORMAT, ENDGE_UI_JSON_RENDERER } from '@/features/core/modules/ui/domain/types/endge-ui-json.types'

// Корень consumer scope ресурсов Computation, принадлежащих JSON-рендеру.
export const ENDGE_UI_JSON_CONSUMER_SCOPE = 'json'

const FORM_TAGS = new Set(['Input', 'Textarea', 'Checkbox', 'Select'])
const TABLE_MENU_TAGS = new Set(['ColumnMenu', 'CellMenu', 'RowMenu', 'MenuItem', 'MenuSeparator'])
const STYLE_PROPS = new Set(['class', 'state', 'part'])
const MAX_VALUE_DEPTH = 32

export const ENDGE_UI_EDIT_EVENTS = ['edit.begin', 'edit.input', 'edit.commit', 'edit.cancel'] as const

type Handler = (payload: unknown) => Promise<void> | void

interface RenderContext {
  props: Record<string, unknown>
  locals: Record<string, unknown>
  context: object
  host: ComponentSFCRenderPort
  dataScope: { boundaryId: string, rowKey: unknown } | null
  idPrefix: string
  consumerScope: string
  componentStack: string[]
  portBindings: readonly ComponentSFCRequiredPortBinding[]
  variant: string
  eventBoundary: ComponentSFCEventBoundary | null
  styleArtifacts: EndgeStyleSheetArtifact[]
  styleOwnerScopeId?: string
  styleParent?: EndgeStyleMatchNode
  runtimeScopeIds: string[]
}

export interface EndgeUIJsonRenderOptions {
  locale?: string
  timezone?: string
  theme?: string
  // Окна строк таблиц по id узла Table.
  tableWindows: ReadonlyMap<string, { offset: number, limit: number }>
  tableRowLimit: number
}

export interface EndgeUIJsonRenderResult {
  snapshot: Omit<EndgeUIJsonSnapshot, 'revision'>
  handlers: Map<string, Map<string, Handler>>
  consumerKeys: Set<string>
}

/**
 * Один проход JSON-рендера: обходит IR так же, как DOM adapter, но вместо VNode строит
 * сериализуемые узлы. Выражения исполняет общий evaluator Core, события идут в
 * `ComponentSFCEventBoundary` host-а, Computation — в ресурсы host-а.
 */
export class EndgeUIJsonRenderer {
  private readonly _handlers = new Map<string, Map<string, Handler>>()
  private readonly _consumerKeys = new Set<string>()
  private readonly _usedIds = new Set<string>()
  private readonly _markers: EndgeUIMarker[] = []

  public constructor(
    private readonly _host: ComponentSFCRenderPort,
    private readonly _options: EndgeUIJsonRenderOptions,
  ) {}

  public render(props: Record<string, unknown>): EndgeUIJsonRenderResult {
    const ir = this._host.getIr()
    const identity = this._host.entityIdentity ?? null
    if (!ir) {
      this._markers.push({ code: 'endge-ui-ir-missing', severity: 'error', message: 'Component SFC IR is not available' })
      return this._result(identity, [])
    }
    const context = this._createRootContext(props, ir)
    return this._result(identity, this._renderNodes(ir.template.roots, context))
  }

  private _result(component: string | null, roots: EndgeUINode[]): EndgeUIJsonRenderResult {
    return {
      snapshot: {
        format: ENDGE_UI_JSON_FORMAT,
        component,
        roots,
        ...(this._markers.length ? { markers: this._markers } : {}),
      },
      handlers: this._handlers,
      consumerKeys: this._consumerKeys,
    }
  }

  private _createRootContext(props: Record<string, unknown>, ir: RComponentSFC_IR): RenderContext {
    const host = this._host
    const lifecycleScope = host.readonly ? null : Endge.runtime.getRuntimeScopeByHost(host.id)
    const runtimeScopeIds = [...(host.runtimeScopeIds ?? [])]
    for (let current = lifecycleScope; current; current = current.parent) {
      runtimeScopeIds.unshift(current.id)
    }
    const styleArtifacts = [...(host.styleArtifacts ?? Endge.styles.getActiveArtifacts())]
    if (ir.style && !styleArtifacts.includes(ir.style)) {
      styleArtifacts.push(ir.style)
    }
    const context: RenderContext = {
      props,
      locals: {},
      context: Object.freeze(Endge.context.runtimeSnapshot()),
      host,
      dataScope: null,
      idPrefix: '',
      consumerScope: ENDGE_UI_JSON_CONSUMER_SCOPE,
      componentStack: host.entityIdentity ? [host.entityIdentity] : [],
      portBindings: [],
      variant: 'default',
      eventBoundary: host.readonly
        ? null
        : new ComponentSFCEventBoundary(host as unknown as ConstructorParameters<typeof ComponentSFCEventBoundary>[0], host.entityIdentity ?? 'component', ir.script.ports),
      styleArtifacts,
      styleOwnerScopeId: ir.style?.scopeId,
      runtimeScopeIds,
    }
    context.locals = this._evaluatePortLocals(ir, context)
    return context
  }

  private _evaluatePortLocals(ir: RComponentSFC_IR, context: RenderContext): Record<string, unknown> {
    const locals: Record<string, unknown> = {}
    for (const call of ir.script.portCalls ?? []) {
      context.locals = locals
      const input = this._evaluate(call.input, context)
      const consumerKey = `${context.consumerScope}:${context.componentStack.join('>')}:${call.port}:${call.local}`
      const identity = context.portBindings.find(binding => binding.port === call.port && binding.kind === 'computation')?.identity
        ?? call.defaultIdentity
      const resource = context.host.getComputationResource(identity, input, consumerKey, call.port)
      this._consumerKeys.add(consumerKey)
      locals[call.local] = {
        get status() { return resource.status },
        get loading() { return resource.loading },
        get value() { return resource.value },
        get error() { return resource.error },
      }
    }
    return locals
  }

  private _evaluate(value: RComponentSFC_IR_Value | undefined, context: RenderContext): unknown {
    if (!value) {
      return undefined
    }
    if (value.kind === 'literal') {
      return value.value
    }
    if (!value.expression) {
      throw new Error('[SFC] Compiled expression is missing. Rebuild the component artifact.')
    }
    return evaluateComponentSFCExpression(value.expression, context)
  }

  private _evaluateProps(node: RComponentSFC_IR_ElementNode, context: RenderContext): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node.props ?? {})) {
      result[key] = this._evaluate(value, context)
    }
    return result
  }

  private _renderNodes(nodes: RComponentSFC_IR_Node[] | undefined, context: RenderContext): EndgeUINode[] {
    const result: EndgeUINode[] = []
    let chainActive = false
    let previousMatched = false
    for (const node of nodes ?? []) {
      if (node.kind !== 'element') {
        chainActive = false
        previousMatched = false
        result.push(this._renderValueNode(node, context))
        continue
      }
      const directives = node.directives
      if ((directives.elseIf || directives.else) && !chainActive) {
        continue
      }
      if (!directives.if && !directives.elseIf && !directives.else) {
        result.push(...this._renderElement(node, context))
        chainActive = false
        previousMatched = false
        continue
      }
      let shouldRender: boolean
      let closesChain = false
      if (directives.if) {
        shouldRender = Boolean(this._evaluate(directives.if, context))
        previousMatched = shouldRender
      }
      else if (directives.elseIf) {
        shouldRender = !previousMatched && Boolean(this._evaluate(directives.elseIf, context))
        previousMatched = previousMatched || shouldRender
      }
      else {
        shouldRender = !previousMatched
        previousMatched = true
        closesChain = true
      }
      if (shouldRender) {
        result.push(...this._renderElement(node, context))
      }
      chainActive = !closesChain
    }
    return result
  }

  private _renderValueNode(node: Exclude<RComponentSFC_IR_Node, RComponentSFC_IR_ElementNode>, context: RenderContext): EndgeUINode {
    const text = node.kind === 'text'
      ? node.value
      : (() => {
          const value = this._evaluate(node.value, context)
          return value == null ? '' : String(value)
        })()
    return { id: this._claimId(`${context.idPrefix}${node.id}`), type: '#text', props: {}, children: [], text }
  }

  private _renderElement(node: RComponentSFC_IR_ElementNode, context: RenderContext): EndgeUINode[] {
    const directive = node.directives.for
    if (!directive) {
      const rendered = this._renderOnce(node, context, `${context.idPrefix}${node.id}`)
      return rendered ? [rendered] : []
    }
    const source = this._evaluate(directive.source, context)
    const entries: Array<[unknown, unknown]> = Array.isArray(source)
      ? source.map((value, index) => [index, value])
      : source && typeof source === 'object'
        ? Object.entries(source as Record<string, unknown>)
        : []
    const result: EndgeUINode[] = []
    entries.forEach(([entryKey, value], index) => {
      const locals: Record<string, unknown> = { [directive.item]: value }
      if (directive.index) {
        locals[directive.index] = index
      }
      const iteration = extendContext(context, locals)
      const key = node.directives.key ? this._evaluate(node.directives.key, iteration) : entryKey
      const token = keyToken(key)
      const id = `${context.idPrefix}${node.id}[${token}]`
      iteration.idPrefix = `${id}/`
      iteration.consumerScope = `${context.consumerScope}/for:${node.id}:${token}`
      const rendered = this._renderOnce(node, iteration, id)
      if (rendered) {
        result.push(rendered)
      }
    })
    return result
  }

  private _renderOnce(node: RComponentSFC_IR_ElementNode, context: RenderContext, rawId: string): EndgeUINode | null {
    const id = this._claimId(rawId)
    const props = this._evaluateProps(node, context)
    if (node.tag === 'Variant' && String(props.name ?? '') !== context.variant) {
      return null
    }
    if (context.host.readonly && FORM_TAGS.has(node.tag)) {
      props.readonly = true
      props.disabled = true
    }
    const styleNode = createStyleNode(node, props, context)
    const result: EndgeUINode = { id, type: node.tag, props: {}, children: [] }
    const markers: EndgeUIMarker[] = []
    applyStyle(result, styleNode, context, this._options.theme)
    const childContext: RenderContext = { ...context, styleParent: styleNode }

    const events = this._registerEvents(id, node, props, context, markers)
    const editable = this._registerEditable(id, node, props, context, events)
    if (editable) {
      result.editable = editable
      if (node.tag === 'Editable') {
        childContext.variant = editable.active ? 'edit' : String(props.variant ?? context.variant ?? 'default')
      }
    }

    if (node.tag === 'Component') {
      this._renderComponent(node, props, context, result, markers)
    }
    else if (node.tag === 'Table') {
      this._renderTable(node, props, childContext, result, markers)
    }
    else {
      result.children = this._renderNodes(node.children, childContext)
    }

    if (node.tag === 'Number') {
      result.text = formatNumber(props.value, props, this._options.locale)
    }
    else if (node.tag === 'DateTime') {
      result.text = formatDateTime(props.value, props.format, props.timezone ?? this._options.timezone, props.empty, this._options.locale)
    }

    for (const [key, value] of Object.entries(props)) {
      if (STYLE_PROPS.has(key) || (node.tag === 'Component' && (key === 'is' || key === 'identity'))) {
        continue
      }
      const json = toJsonValue(value)
      if (json !== undefined) {
        result.props[key] = json
      }
    }
    if (events.size) {
      result.events = [...events]
    }
    if (markers.length) {
      result.markers = markers
    }
    return result
  }

  private _source(node: RComponentSFC_IR_ElementNode, props: Record<string, unknown>, id: string): ComponentSFCEventRuntimeSource {
    const ref = typeof props.ref === 'string' && props.ref.trim() ? props.ref.trim() : undefined
    return {
      nodeId: node.id,
      ref,
      componentTag: node.componentTag ?? node.tag,
      target: { type: 'component.node', identity: String(props.id ?? props.ref ?? node.id), value: id },
    }
  }

  private _registerEvents(
    id: string,
    node: RComponentSFC_IR_ElementNode,
    props: Record<string, unknown>,
    context: RenderContext,
    markers: EndgeUIMarker[],
  ): Set<string> {
    const names = new Set<string>()
    const boundary = context.eventBoundary
    if (!boundary || node.tag === 'Component') {
      return names
    }
    const source = this._source(node, props, id)
    const scope = { ...context.props, ...context.locals }
    for (const definition of getComponentSFCIntrinsicEventDefinitions(node.tag)) {
      const bindings = (node.events ?? []).filter(binding => binding.name === definition.name)
      if (!bindings.length && !boundary.observesChild(source, definition.name)) {
        continue
      }
      names.add(definition.name)
      this._addHandler(id, definition.name, async (payload) => {
        await boundary.routeChild(source, definition.name, normalizePayload(definition.name, payload), bindings, [], 0, scope)
      })
    }

    const interactions = (node.interactions ?? []).flatMap(group => this._evaluateInteractionGroup(group, context, markers))
    const byEvent = new Map<string, typeof interactions>()
    for (const entry of interactions) {
      byEvent.set(entry.trigger.event, [...(byEvent.get(entry.trigger.event) ?? []), entry])
    }
    for (const [event, candidates] of byEvent) {
      names.add(event)
      const fallback = this._handlers.get(id)?.get(event)
      this._addHandler(id, event, async (payload) => {
        const normalized = normalizePayload(event, payload)
        const snapshot = createTriggerEvent(normalized)
        const selected = candidates.find(({ trigger }) => matchesComponentSFCInteractionTrigger(trigger, snapshot, 'unknown'))
        if (!selected) {
          await fallback?.(payload)
          return
        }
        if (selected.trigger.once && !boundary.claimLocalOnce(`${id}:${event}:${selected.index}`)) {
          return
        }
        const binding: RComponentSFC_IR_EventBinding = {
          name: event,
          modifiers: interactionModifiers(selected.trigger),
          action: selected.reactions[0]!,
          actions: selected.reactions,
        }
        await boundary.routeChild(source, event, normalized, [binding], [], 0, scope)
      })
    }
    return names
  }

  private _evaluateInteractionGroup(
    group: NonNullable<RComponentSFC_IR_ElementNode['interactions']>[number],
    context: RenderContext,
    markers: EndgeUIMarker[],
  ): Array<{ trigger: ComponentSFCInteractionTrigger, reactions: RComponentSFC_IR_InteractionRule['reactions'], index: number }> {
    const result: Array<{ trigger: ComponentSFCInteractionTrigger, reactions: RComponentSFC_IR_InteractionRule['reactions'], index: number }> = []
    const push = (trigger: ComponentSFCInteractionTrigger | undefined, modifiers: readonly RComponentSFC_IR_EventModifier[], reactions: RComponentSFC_IR_InteractionRule['reactions']) => {
      if (!trigger || !reactions.length) {
        return
      }
      if (trigger.held) {
        markers.push({ code: 'endge-ui-held-keys', severity: 'info', message: `Trigger "${trigger.event}" checks held keys; the host must pass payload.held` })
      }
      result.push({ trigger: applySuffixModifiers(trigger, modifiers), reactions, index: result.length })
    }
    for (const rule of group.rules) {
      push(normalizeComponentSFCInteractionTriggers(this._evaluate(rule.trigger, context))[0], rule.modifiers, rule.reactions)
    }
    if (group.triggerSet) {
      const supported = new Set(group.triggerSet.events)
      for (const trigger of normalizeComponentSFCInteractionTriggers(this._evaluate(group.triggerSet.triggers, context))) {
        if (supported.has(trigger.event)) {
          push(trigger, group.triggerSet.modifiers, group.triggerSet.reactions)
        }
      }
    }
    return result
  }

  private _registerEditable(
    id: string,
    node: RComponentSFC_IR_ElementNode,
    props: Record<string, unknown>,
    context: RenderContext,
    events: Set<string>,
  ): EndgeUIEditableState | null {
    if (!node.editable) {
      return null
    }
    const host = context.host
    const key = `${context.consumerScope}/editable:${node.id}`
    const session = host.getEditSession(key)
    const value = this._evaluate(node.editable.value, context)
    const state: EndgeUIEditableState = {
      active: Boolean(session),
      value: toJsonValue(value) ?? null,
      triggers: normalizeComponentSFCInteractionTriggers(this._evaluate(node.editable.triggers, context))
        .map(trigger => toJsonValue(trigger) ?? null),
    }
    if (session) {
      state.draft = toJsonValue(session.draftValue) ?? null
    }
    if (host.readonly || !context.eventBoundary) {
      return state
    }
    const boundary = context.eventBoundary
    const scope = { ...context.props, ...context.locals }
    ENDGE_UI_EDIT_EVENTS.forEach(event => events.add(event))
    this._addHandler(id, 'edit.begin', () => {
      host.beginEditSession(key, this._evaluate(node.editable?.value, context), String(props.variant ?? context.variant ?? 'default'))
    })
    this._addHandler(id, 'edit.input', (payload) => {
      host.updateEditDraft(key, readPayloadValue(payload))
    })
    this._addHandler(id, 'edit.cancel', () => {
      host.cancelEditSession(key)
    })
    this._addHandler(id, 'edit.commit', async (payload) => {
      const value = readPayloadValue(payload)
      const committed = value === undefined ? host.commitEditSession(key) : host.commitEditSession(key, value)
      if (!committed) {
        return
      }
      await boundary.routeChild({ nodeId: node.id, componentTag: node.componentTag ?? node.tag }, 'edited', committed, node.events ?? [], [], 0, scope)
    })
    return state
  }

  private _renderComponent(
    node: RComponentSFC_IR_ElementNode,
    props: Record<string, unknown>,
    context: RenderContext,
    result: EndgeUINode,
    markers: EndgeUIMarker[],
  ): void {
    const identity = String(
      (node.port ? context.portBindings.find(binding => binding.port === node.port?.port && binding.kind === 'component')?.identity : null)
      ?? props.is
      ?? props.identity
      ?? '',
    ).trim()
    if (!identity) {
      markers.push({ code: 'endge-ui-component-missing', severity: 'error', message: 'component identity is empty' })
      return
    }
    result.component = identity
    if (context.componentStack.includes(identity)) {
      markers.push({ code: 'endge-ui-component-cycle', severity: 'error', message: `component cycle: ${[...context.componentStack, identity].join(' -> ')}` })
      return
    }
    const artifacts = context.host.getArtifactReader() ?? Endge.program
    const artifact = artifacts.getArtifact<ComponentSFCProgramPayload>('component-sfc', identity)
    const ir = (artifact?.payload as { ir?: RComponentSFC_IR } | undefined)?.ir
    if (!artifact || !ir || !artifact.capabilities.includes('renderable')) {
      markers.push({ code: 'endge-ui-component-missing', severity: 'error', message: `component:${identity} is not renderable` })
      return
    }
    if (node.interactions?.length) {
      markers.push({ code: 'endge-ui-unsupported', severity: 'warning', message: 'Semantic `:on` interactions on a nested Component are not exported to JSON UI' })
    }
    const portBindings = node.portBindings ?? []
    const childProps = { ...props }
    delete childProps.is
    delete childProps.identity
    delete childProps.variant
    const childBoundary = context.eventBoundary?.createChild(identity, ir.script.ports, {
      nodeId: node.id,
      ref: node.props.ref?.kind === 'literal' && typeof node.props.ref.value === 'string' ? node.props.ref.value : undefined,
      componentIdentity: identity,
      componentTag: node.componentTag ?? 'Component',
    }, node.events ?? [], undefined, portBindings) ?? null
    const styleArtifacts = [...context.styleArtifacts]
    if (ir.style && !styleArtifacts.includes(ir.style)) {
      styleArtifacts.push(ir.style)
    }
    const childContext: RenderContext = {
      ...context,
      props: childProps,
      locals: {},
      dataScope: context.dataScope,
      idPrefix: `${result.id}>`,
      consumerScope: `${context.consumerScope}/component:${node.id}:${identity}`,
      componentStack: [...context.componentStack, identity],
      portBindings,
      variant: String(props.variant ?? 'default'),
      eventBoundary: childBoundary,
      styleArtifacts,
      styleOwnerScopeId: ir.style?.scopeId,
    }
    childContext.locals = this._evaluatePortLocals(ir, childContext)
    result.children = this._renderNodes(ir.template.roots, childContext)
  }

  private _renderTable(
    node: RComponentSFC_IR_ElementNode,
    props: Record<string, unknown>,
    context: RenderContext,
    result: EndgeUINode,
    markers: EndgeUIMarker[],
  ): void {
    const rows = Array.isArray(props.rows) ? props.rows as unknown[] : []
    delete props.rows
    const rowKeyPath = String(props['row-key'] ?? props.rowKey ?? 'id')
    const window = this._options.tableWindows.get(result.id) ?? { offset: 0, limit: this._options.tableRowLimit }
    const tableContext = extendContext(context, {
      $table: { id: String(props.id ?? node.id), runtimeId: (context.host.runtimeState as { runtimeId?: string } | null)?.runtimeId ?? node.id, state: {} },
    })
    tableContext.consumerScope = `${context.consumerScope}/table:${node.id}`
    const columnNodes = node.children.filter((child): child is RComponentSFC_IR_ElementNode => child.kind === 'element' && child.tag === 'Column')
    const columns = columnNodes.map((columnNode, index) => {
      const columnProps = this._evaluateProps(columnNode, tableContext)
      const key = String(columnProps.key ?? this._evaluate(columnNode.directives.key, tableContext) ?? staticKey(columnNode) ?? columnProps.field ?? `column_${index}`)
      const column: EndgeUITableColumn = { key, title: String(columnProps.title ?? columnProps.name ?? key) }
      const width = Number(columnProps.width ?? columnProps.size)
      if (Number.isFinite(width) && width > 0) {
        column.width = width
      }
      const align = columnProps['cell-align'] ?? columnProps.cellAlign ?? columnProps.align
      if (typeof align === 'string') {
        column.align = align
      }
      if (columnProps.sortable === true) {
        column.sortable = true
      }
      if (node.tableMenus?.column.mode === 'inline' && node.tableMenus.column.menu) {
        column.menu = this._resolveMenu(node.tableMenus.column.menu, extendContext(tableContext, { $column: { key, index, title: column.title } }))
      }
      const cellNode = columnNode.children.find((child): child is RComponentSFC_IR_ElementNode => child.kind === 'element' && child.tag === 'Cell') ?? null
      const cellNodes = (cellNode?.children ?? columnNode.children).filter(child => !(child.kind === 'element' && TABLE_MENU_TAGS.has(child.tag)))
      const cellMenu = columnNode.cellMenu ?? node.tableMenus?.row ?? null
      return { column, index, cellNode, cellNodes, cellMenu }
    })
    const offset = Math.max(0, Math.min(window.offset, rows.length))
    const visible = rows.slice(offset, offset + window.limit)
    result.table = { rowKey: rowKeyPath, columns: columns.map(entry => entry.column), rowCount: rows.length, offset, limit: window.limit }
    if (rows.length > visible.length) {
      markers.push({ code: 'endge-ui-table-window', severity: 'info', message: `Table shows rows ${offset}..${offset + visible.length} of ${rows.length}; dispatch "table.page" to move the window` })
    }
    result.children = visible.map((row, visibleIndex) => {
      const rowIndex = offset + visibleIndex
      const record = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
      const rowKey = readValuePath(record, rowKeyPath) ?? rowIndex
      const rowId = this._claimId(`${result.id}[${keyToken(rowKey)}]`)
      const cells = columns.map(({ column, index, cellNode, cellNodes, cellMenu }) => {
        const value = readValuePath(record, column.key)
        const cellContext = extendContext(tableContext, {
          $row: { id: String(rowKey), index: rowIndex, data: record },
          $column: { key: column.key, index, title: column.title, metadata: {} },
          $cell: { value },
          row: record,
          // rowId — строковая identity строки, как в Vue-адаптере (локали таблиц SFC).
          rowId: String(rowKey),
          rowIndex,
          rowKey,
          columnKey: column.key,
          columnMeta: {},
          value,
        })
        cellContext.dataScope = { boundaryId: node.id, rowKey }
        const cellId = this._claimId(`${rowId}.${keyToken(column.key)}`)
        cellContext.idPrefix = `${cellId}/`
        cellContext.consumerScope = `${tableContext.consumerScope}/row:${keyToken(rowKey)}/column:${keyToken(column.key)}`
        const cell: EndgeUINode = {
          id: cellId,
          type: '#cell',
          props: { column: column.key, value: toJsonValue(value) ?? null },
          children: this._renderNodes(cellNodes, cellContext),
        }
        if (cellNode) {
          const cellProps = this._evaluateProps(cellNode, cellContext)
          const events = this._registerEvents(cellId, cellNode, cellProps, cellContext, markers)
          if (events.size) {
            cell.events = [...events]
          }
        }
        if (cellMenu?.mode === 'inline' && cellMenu.menu) {
          const menu = this._resolveMenu(cellMenu.menu, cellContext)
          if (menu.items.length) {
            cell.menu = menu
            cell.events = [...new Set([...(cell.events ?? []), 'menu.select'])]
            this._addMenuHandler(cellId, cellMenu.menu, cellContext, { row: record, rowKey, column: column.key })
          }
        }
        return cell
      })
      return { id: rowId, type: '#row', props: { key: toJsonValue(rowKey) ?? null, index: rowIndex }, children: cells } satisfies EndgeUINode
    })
    if (columns.some(entry => entry.column.menu)) {
      result.events = [...new Set([...(result.events ?? []), 'menu.select'])]
      const menus = new Map(columns.map(entry => [entry.column.key, entry]))
      this._addHandler(result.id, 'menu.select', async (payload) => {
        const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
        const column = menus.get(String(record.column ?? ''))
        if (column && node.tableMenus?.column.menu) {
          await this._runMenuItem(node.tableMenus.column.menu, extendContext(tableContext, { $column: { key: column.column.key, index: column.index, title: column.column.title } }), String(record.item ?? ''), { column: column.column.key })
        }
      })
    }
    this._addHandler(result.id, 'table.page', () => {})
    result.events = [...new Set([...(result.events ?? []), 'table.page'])]
  }

  private _resolveMenu(descriptor: ComponentSFCTableMenuDescriptor, context: RenderContext): EndgeUIMenu {
    const items: EndgeUIMenu['items'] = []
    for (const item of descriptor.items) {
      if (item.kind === 'separator') {
        if (items.length && items.at(-1)?.kind !== 'separator') {
          items.push({ kind: 'separator', id: item.id })
        }
        continue
      }
      if (item.visible && !this._evaluate(item.visible, context)) {
        continue
      }
      const label = String(this._evaluate(item.label, context) ?? '').trim()
      if (!label) {
        continue
      }
      items.push({
        kind: 'item',
        id: item.id,
        label,
        action: this._menuAction(item, context),
        ...(item.icon ? { icon: item.icon } : {}),
        ...(item.disabled ? { disabled: Boolean(this._evaluate(item.disabled, context)) } : {}),
      })
    }
    if (items.at(-1)?.kind === 'separator') {
      items.pop()
    }
    return { items }
  }

  private _menuAction(item: Extract<ComponentSFCTableMenuDescriptor['items'][number], { kind: 'item' }>, context: RenderContext): string {
    return item.requiredPort
      ? context.portBindings.find(binding => binding.kind === 'action' && binding.port === item.requiredPort)?.identity ?? item.action
      : item.action
  }

  private _addMenuHandler(id: string, descriptor: ComponentSFCTableMenuDescriptor, context: RenderContext, target: Record<string, unknown>): void {
    this._addHandler(id, 'menu.select', async (payload) => {
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
      await this._runMenuItem(descriptor, context, String(record.item ?? ''), target)
    })
  }

  private async _runMenuItem(descriptor: ComponentSFCTableMenuDescriptor, context: RenderContext, itemId: string, target: Record<string, unknown>): Promise<void> {
    const item = descriptor.items.find(candidate => candidate.kind === 'item' && candidate.id === itemId)
    if (!item || item.kind !== 'item') {
      return
    }
    if ((item.visible && !this._evaluate(item.visible, context)) || (item.disabled && this._evaluate(item.disabled, context))) {
      return
    }
    await Endge.actions.execute(this._menuAction(item, context), {
      ...(item.input ? { input: this._evaluate(item.input, context) } : {}),
      context: { source: 'endge-ui-json', component: context.componentStack.at(-1) ?? null, ...target },
    })
  }

  private _addHandler(id: string, event: string, handler: Handler): void {
    let handlers = this._handlers.get(id)
    if (!handlers) {
      handlers = new Map()
      this._handlers.set(id, handlers)
    }
    handlers.set(event, handler)
  }

  private _claimId(id: string): string {
    let candidate = id
    let suffix = 1
    while (this._usedIds.has(candidate)) {
      candidate = `${id}~${suffix++}`
    }
    this._usedIds.add(candidate)
    return candidate
  }
}

// Статический `key="status"` компилируется в expression без reads; DOM adapter читает его source.
function staticKey(node: RComponentSFC_IR_ElementNode): string | undefined {
  const key = node.directives.key
  return key?.kind === 'expression' && key.reads.length === 0 ? key.source.replace(/^['"]|['"]$/g, '') : undefined
}

function extendContext(context: RenderContext, locals: Record<string, unknown>): RenderContext {
  return { ...context, locals: { ...context.locals, ...locals } }
}

function keyToken(key: unknown): string {
  const text = typeof key === 'string' ? key : (toJsonValue(key) === undefined ? String(key) : JSON.stringify(toJsonValue(key)))
  return text.replace(/[[\]/>.~]/g, char => `%${char.charCodeAt(0).toString(16)}`)
}

function createStyleNode(node: RComponentSFC_IR_ElementNode, props: Record<string, unknown>, context: RenderContext): EndgeStyleMatchNode {
  return {
    tag: node.tag,
    id: typeof props.id === 'string' && props.id.trim() ? props.id.trim() : undefined,
    classes: tokenSet(props.class),
    attributes: props,
    states: tokenSet(props.state),
    parts: tokenSet(props.part),
    component: node.componentTag,
    identity: node.tag === 'Component' ? String(props.is ?? props.identity ?? '').trim() || undefined : undefined,
    ownerScopeId: context.styleOwnerScopeId,
    runtimeScopeIds: new Set(context.runtimeScopeIds),
    parent: context.styleParent,
    index: 1,
    siblingCount: 1,
  }
}

function applyStyle(result: EndgeUINode, styleNode: EndgeStyleMatchNode, context: RenderContext, theme: string | undefined): void {
  if (styleNode.classes.size) {
    result.classes = [...styleNode.classes]
  }
  if (styleNode.states.size) {
    result.states = [...styleNode.states]
  }
  if (styleNode.parts.size) {
    result.parts = [...styleNode.parts]
  }
  if (!context.styleArtifacts.length) {
    return
  }
  const declarations = resolveEndgeStyleDeclarations(context.styleArtifacts, styleNode, { renderer: ENDGE_UI_JSON_RENDERER }, theme ?? Endge.ui.theme)
  const entries = Object.entries(declarations)
  if (entries.length) {
    result.style = Object.fromEntries(entries.map(([property, declaration]) => [property, declaration.value]))
  }
}

function tokenSet(value: unknown): Set<string> {
  const result = new Set<string>()
  const visit = (item: unknown): void => {
    if (typeof item === 'string') {
      item.trim().split(/\s+/).filter(Boolean).forEach(token => result.add(token))
    }
    else if (Array.isArray(item)) {
      item.forEach(visit)
    }
    else if (item && typeof item === 'object') {
      Object.entries(item as Record<string, unknown>).forEach(([key, enabled]) => enabled && result.add(key))
    }
  }
  visit(value)
  return result
}

function applySuffixModifiers(trigger: ComponentSFCInteractionTrigger, modifiers: readonly RComponentSFC_IR_EventModifier[]): ComponentSFCInteractionTrigger {
  return {
    ...trigger,
    stop: trigger.stop || modifiers.includes('stop'),
    prevent: trigger.prevent || modifiers.includes('prevent'),
    self: trigger.self || modifiers.includes('self'),
    once: trigger.once || modifiers.includes('once'),
    capture: trigger.capture || modifiers.includes('capture'),
    passive: trigger.passive || modifiers.includes('passive'),
  }
}

function interactionModifiers(trigger: ComponentSFCInteractionTrigger): RComponentSFC_IR_EventModifier[] {
  return (['stop', 'prevent', 'self', 'capture', 'passive'] as const).filter(name => trigger[name] === true)
}

// Дополняет payload host-а полями нормализованного события SFC.
function normalizePayload(event: string, payload: unknown): Record<string, unknown> {
  const record: Record<string, unknown> = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...payload as Record<string, unknown> }
    : (payload === undefined ? {} : { value: payload })
  const modifiers = record.modifiers && typeof record.modifiers === 'object' ? record.modifiers as Record<string, unknown> : {}
  return {
    ...record,
    type: event,
    occurredAt: typeof record.occurredAt === 'string' ? record.occurredAt : new Date().toISOString(),
    held: record.held ?? { key: [], code: [] },
    modifiers: {
      ctrl: modifiers.ctrl === true,
      shift: modifiers.shift === true,
      alt: modifiers.alt === true,
      meta: modifiers.meta === true,
      altGraph: modifiers.altGraph === true,
    },
  }
}

function createTriggerEvent(payload: Record<string, unknown>): ComponentSFCInteractionTriggerEvent {
  const held = payload.held as { key?: unknown, code?: unknown }
  return {
    ...(typeof payload.key === 'string' ? { key: payload.key } : {}),
    ...(typeof payload.code === 'string' ? { code: payload.code } : {}),
    repeat: payload.repeat === true,
    composing: payload.composing === true,
    ...(typeof payload.button === 'number' ? { button: payload.button } : {}),
    targetIsCurrentTarget: payload.self !== false,
    held: {
      key: Array.isArray(held?.key) ? held.key.map(String) : [],
      code: Array.isArray(held?.code) ? held.code.map(String) : [],
    },
    modifiers: payload.modifiers as ComponentSFCInteractionTriggerEvent['modifiers'],
  }
}

function readPayloadValue(payload: unknown): unknown {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'value' in payload) {
    return (payload as { value: unknown }).value
  }
  return payload
}

// Приводит вычисленное значение к JSON: функции и undefined отбрасываются, Date → ISO, нечисла → null.
function toJsonValue(value: unknown, depth = 0, seen = new WeakSet<object>()): EndgeUIJsonValue | undefined {
  if (value === null) {
    return null
  }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : null
    case 'bigint':
      return value.toString()
    case 'undefined':
    case 'function':
    case 'symbol':
      return undefined
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  const object = value as object
  if (depth >= MAX_VALUE_DEPTH || seen.has(object)) {
    return null
  }
  seen.add(object)
  try {
    if (Array.isArray(object)) {
      return object.map(item => toJsonValue(item, depth + 1, seen) ?? null)
    }
    const result: Record<string, EndgeUIJsonValue> = {}
    for (const [key, item] of Object.entries(object)) {
      const json = toJsonValue(item, depth + 1, seen)
      if (json !== undefined) {
        result[key] = json
      }
    }
    return result
  }
  finally {
    seen.delete(object)
  }
}

function formatNumber(value: unknown, props: Record<string, unknown>, locale: string | undefined): string {
  if (value == null) {
    return props.empty == null ? '' : String(props.empty)
  }
  const numberValue = Number(value)
  if (!Number.isFinite(numberValue)) {
    return String(value)
  }
  const optional = (input: unknown) => {
    const parsed = input == null || input === '' ? Number.NaN : Number(input)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: optional(props.minFractionDigits),
    maximumFractionDigits: optional(props.maxFractionDigits ?? props.decimals),
  }).format(numberValue)
  return `${props.prefix ?? ''}${formatted}${props.suffix ?? ''}`
}

const DATE_TIME_OPTIONS: Record<'time' | 'date' | 'datetime', Intl.DateTimeFormatOptions> = {
  time: { hour: '2-digit', minute: '2-digit', hour12: false },
  date: {},
  datetime: { dateStyle: 'medium', timeStyle: 'short' },
}

function formatDateTime(value: unknown, format: unknown, timezone: unknown, empty: unknown, locale: string | undefined): string {
  if (value == null || value === '') {
    return empty == null ? '' : String(empty)
  }
  const text = String(value).trim()
  const timeOnly = format === 'HH:mm' ? /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(text) : null
  if (timeOnly) {
    return `${timeOnly[1]}:${timeOnly[2]}`
  }
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    return String(value)
  }
  const kind = format === 'HH:mm' ? 'time' : format === 'date' ? 'date' : 'datetime'
  const zone = String(timezone ?? '').trim()
  const timeZone = !zone || zone === 'local' ? undefined : zone
  try {
    return new Intl.DateTimeFormat(locale, { ...DATE_TIME_OPTIONS[kind], ...(timeZone ? { timeZone } : {}) }).format(date)
  }
  catch {
    return new Intl.DateTimeFormat(locale, DATE_TIME_OPTIONS[kind]).format(date)
  }
}
