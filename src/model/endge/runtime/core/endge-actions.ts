import type { RField } from '@/domain/entities/reflect/RField'
import { RAction } from '@/domain/entities/reflect/RAction'
import type {
  ActionDefinitionInput,
  ActionExecuteOptions,
  ActionExecutionTarget,
  ImplementationBindingScope,
  ResolvedActionDescriptor,
  RuntimeAction,
  RuntimeActionContext,
  RuntimeActionId,
  RuntimeActionRegistrySnapshot,
  TableColumnActionContext,
} from '@/domain/types/runtime/action.types'
import { BUILTIN_ACTION_IDS } from '@/domain/types/runtime/action.types'
import type { ImplementationInvocation, ImplementationProvider } from '@/domain/types/runtime/implementation.types'
import { Subscribable } from '@endge/utils'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeImplementations } from '@/model/endge/runtime/implementation/endge-implementations'
import { normalizeActionTargets, validateActionTarget } from '@/model/services/compiler/action/action-target-validation'
import { createTableRuntimeActions } from '@/model/services/runtime/table-actions'

const FLOW_PROVIDER_KEY = 'core.action.flow'
const COMPONENT_PORT_PROVIDER_KEY = 'core.action.component-port'

export interface CodeActionDefinition extends Omit<ActionDefinitionInput, 'owner'> {
  owner: string
  catalogPath?: readonly string[]
  providerKey?: string
  execute?: ImplementationProvider['execute']
  canExecute?: ImplementationProvider['canExecute']
}

export interface ActionOverrideInput {
  owner: string
  providerKey?: string
  execute?: ImplementationProvider['execute']
  canExecute?: ImplementationProvider['canExecute']
  scope?: Exclude<ImplementationBindingScope, 'default' | 'invocation'>
  scopeIdentity?: string
  priority?: number
}

/** Action-specific facade over semantic definitions and generic implementations. */
export class EndgeActions extends Subscribable {
  private readonly _codeActions = new Map<string, RAction>()
  private readonly _catalogPaths = new Map<string, string[]>()
  private readonly _codeActionDisposers = new Map<string, () => void>()
  private readonly _providerDisposers: Array<() => void> = []
  private _hasSynchronizedResolvedIndex = false

  public constructor(
    private readonly _implementations: EndgeImplementations,
  ) {
    super()
    this.reset()
  }

  /** Rebuilds code-owned defaults. Local application code registers again after reset. */
  public reset(): void {
    if (this._hasSynchronizedResolvedIndex) {
      for (const identity of this._codeActions.keys())
        Endge.domain.resolved.delete('action', identity)
    }
    this._codeActions.clear()
    this._catalogPaths.clear()
    this._codeActionDisposers.clear()
    this._implementations.clear()
    this._providerDisposers.splice(0).forEach(dispose => dispose())
    this._registerCoreProviders()
    this._registerCoreActions()
    this._registerTableActions()
    this.notify()
  }

  /** Defines a core/plugin Action that has no Payload record. */
  public defineBuiltin(definition: CodeActionDefinition): () => void {
    if (this._findAction(definition.identity))
      throw new Error(`Action identity collision: ${definition.identity}. Use Endge.actions.override() explicitly.`)
    return this._defineCodeAction(definition, { kind: 'builtin', owner: definition.owner })
  }

  /** Defines a session-local Action. Identity collisions must use explicit override(). */
  public defineLocal(definition: CodeActionDefinition): () => void {
    if (this._findAction(definition.identity))
      throw new Error(`Action identity collision: ${definition.identity}. Use Endge.actions.override() explicitly.`)
    return this._defineCodeAction(definition, { kind: 'local', owner: definition.owner })
  }

  /** Binds local code over an existing Action without mutating its definition. */
  public override(identity: string, override: ActionOverrideInput): () => void {
    const action = this._findAction(identity)
    if (!action)
      throw new Error(`Action cannot be overridden because it does not exist: ${identity}.`)

    const providerKey = override.providerKey ?? `local.override.${override.owner}.${identity}`
    const disposeProvider = override.execute
      ? this._implementations.registerProvider({
          key: providerKey,
          origin: { kind: 'local', owner: override.owner },
          contract: this._contractOf(action),
          execute: override.execute,
          canExecute: override.canExecute,
        })
      : () => {}
    const disposeBinding = this._implementations.bind({
      executableType: 'action',
      executableIdentity: identity,
      providerKey,
      scope: override.scope ?? 'application',
      scopeIdentity: override.scopeIdentity,
      priority: override.priority,
    })
    this.notify()
    return () => {
      disposeBinding()
      disposeProvider()
      this.notify()
    }
  }

  /** Executes a resolved Action through the generic implementation pipeline. */
  public async execute<TResult = unknown>(
    identity: RuntimeActionId,
    optionsOrContext: ActionExecuteOptions | RuntimeActionContext = {},
    legacyPayload?: unknown,
  ): Promise<TResult | undefined> {
    const action = this._findAction(identity)
    if (!action)
      throw new Error(`Action is not defined: ${identity}.`)
    if (action.active === false)
      throw new Error(`Action is inactive: ${identity}.`)

    const legacy = this._isLegacyContext(optionsOrContext)
    const options: ActionExecuteOptions = legacy
      ? {
          input: legacyPayload,
          target: this._legacyTarget(optionsOrContext),
          context: optionsOrContext as unknown as Record<string, unknown>,
        }
      : optionsOrContext as ActionExecuteOptions
    validateActionTarget(normalizeActionTargets(action.target), options.target)

    const defaultProviderKey = this._defaultProviderKey(action)
    return await this._implementations.execute<TResult>({
      executable: { type: 'action', identity: action.identity, value: action },
      defaultProviderKey,
      scopeIdentities: options.resolution,
      invocationProviderKey: options.providerKey,
      expectedContract: this._contractOf(action),
    }, {
      executable: { type: 'action', identity: action.identity, value: action },
      input: options.input,
      target: options.target,
      context: options.context,
    })
  }

  /** Returns effective definitions for palettes and the Domain Widget. */
  public listResolved(): ResolvedActionDescriptor[] {
    this._syncResolvedIndex()
    const all = [...Endge.domain.getActions(), ...Endge.domain.resolved.list<RAction>('action')]
    const unique = new Map<string, RAction>()
    for (const action of all) {
      if (!unique.has(action.identity))
        unique.set(action.identity, action)
    }
    return [...unique.values()].map(action => this._describe(action))
      .sort((left, right) => left.identity.localeCompare(right.identity))
  }

  /** Compatibility projection for existing context-menu code. */
  public list(input?: { surface?: string }): RuntimeAction[] {
    return this.listResolved()
      .filter(action => !input?.surface || action.identity.startsWith(input.surface === 'table-column-header' ? 'table.' : ''))
      .map(action => this._legacyAction(action.identity))
  }

  public get(id: RuntimeActionId): RuntimeAction | null {
    return this._findAction(id) ? this._legacyAction(id) : null
  }

  public has(id: RuntimeActionId): boolean {
    return this._findAction(id) != null
  }

  /** Compiler inspection API for code-owned identity collision diagnostics. */
  public getCodeDefinition(identity: string): RAction | null {
    return this._codeActions.get(String(identity ?? '').trim()) ?? null
  }

  /** Returns the semantic definition regardless of storage origin. */
  public getDefinition(identity: string): RAction | null {
    return this._findAction(identity)
  }

  public canExecute(id: RuntimeActionId, context: RuntimeActionContext, payload?: unknown): boolean {
    const action = this._findAction(id)
    if (!action || action.active === false)
      return false
    try {
      const target = this._legacyTarget(context)
      validateActionTarget(normalizeActionTargets(action.target), target)
      const resolved = this._implementations.resolve({
        executable: { type: 'action', identity: id, value: action },
        defaultProviderKey: this._defaultProviderKey(action),
        expectedContract: this._contractOf(action),
      })
      return resolved.provider.canExecute?.({
        executable: { type: 'action', identity: id, value: action },
        input: payload,
        target,
        context: context as unknown as Record<string, unknown>,
      }) ?? true
    }
    catch {
      return false
    }
  }

  /** @deprecated Use defineLocal(), defineBuiltin() or override(). */
  public register(action: RuntimeAction): () => void {
    return this.defineLocal({
      identity: action.id,
      displayName: action.label ?? action.id,
      description: action.description,
      owner: 'legacy-runtime-action',
      execute: invocation => action.execute(invocation.context as unknown as RuntimeActionContext, invocation.input),
      canExecute: action.canExecute
        ? invocation => action.canExecute!(invocation.context as unknown as RuntimeActionContext, invocation.input)
        : undefined,
    })
  }

  public unregister(id: RuntimeActionId): void {
    this._codeActionDisposers.get(id)?.()
  }

  public serialize(): RuntimeActionRegistrySnapshot {
    return {
      actions: this.listResolved().map(action => ({
        id: action.identity,
        label: action.displayName,
        description: action.description ?? undefined,
      })),
    }
  }

  private _defineCodeAction(definition: CodeActionDefinition, origin: RAction['origin']): () => void {
    const identity = String(definition.identity ?? '').trim()
    if (!identity)
      throw new Error('Action identity is required.')
    if (this._codeActions.has(identity))
      throw new Error(`Action identity collision: ${identity}. Use Endge.actions.override() explicitly.`)

    const providerKey = definition.providerKey ?? `${origin.kind}.${definition.owner}.${identity}`
    const action = new RAction()
    action.identity = identity
    action.name = definition.displayName ?? identity
    action.displayName = definition.displayName ?? identity
    action.description = definition.description ?? null
    action.active = definition.active !== false
    action.origin = origin
    action.managedBy = origin.kind === 'builtin' ? 'system' : 'user'
    action.owner = { type: 'module', identity: definition.owner }
    action.target = normalizeActionTargets(definition.target ?? null)
    action.input = (definition.input ?? null) as RField | null
    action.output = (definition.output ?? null) as RField | null
    action.defaultImplementation = definition.defaultImplementation
      ?? { kind: 'provider', providerKey }

    const disposeProvider = definition.execute
      ? this._implementations.registerProvider({
          key: providerKey,
          origin,
          contract: this._contractOf(action),
          execute: definition.execute,
          canExecute: definition.canExecute,
        })
      : () => {}
    this._codeActions.set(identity, action)
    this._catalogPaths.set(identity, (definition.catalogPath ?? [])
      .map(segment => String(segment ?? '').trim())
      .filter(Boolean))
    this.notify()

    let disposed = false
    const dispose = () => {
      if (disposed) return
      disposed = true
      disposeProvider()
      if (this._codeActions.get(identity) === action)
        this._codeActions.delete(identity)
      this._catalogPaths.delete(identity)
      if (this._codeActionDisposers.get(identity) === dispose)
        this._codeActionDisposers.delete(identity)
      Endge.domain.resolved.delete('action', identity)
      this.notify()
    }
    this._codeActionDisposers.set(identity, dispose)
    return dispose
  }

  private _findAction(identity: string): RAction | null {
    return Endge.domain.getAction(identity)
      ?? this._codeActions.get(identity)
      ?? Endge.domain.resolved.get<RAction>('action', identity)
  }

  private _defaultProviderKey(action: RAction): string | null {
    if (action.defaultImplementation.kind === 'flow') return FLOW_PROVIDER_KEY
    if (action.defaultImplementation.kind === 'component-port') return COMPONENT_PORT_PROVIDER_KEY
    return action.defaultImplementation.providerKey
  }

  private _contractOf(action: RAction) {
    return {
      target: normalizeActionTargets(action.target),
      input: action.input,
      output: action.output,
    }
  }

  private _describe(action: RAction): ResolvedActionDescriptor {
    let effectiveProviderKey: string | null = null
    let effectiveProviderOrigin = null
    let bindingScope: ImplementationBindingScope | null = null
    try {
      const resolved = this._implementations.resolve({
        executable: { type: 'action', identity: action.identity, value: action },
        defaultProviderKey: this._defaultProviderKey(action),
        expectedContract: this._contractOf(action),
      })
      effectiveProviderKey = resolved.provider.key
      effectiveProviderOrigin = resolved.provider.origin
      bindingScope = resolved.scope
    }
    catch {}
    return {
      identity: action.identity,
      displayName: action.displayName ?? action.name ?? action.identity,
      description: action.description ?? null,
      active: action.active !== false,
      origin: action.origin,
      catalogPath: [...(this._catalogPaths.get(action.identity) ?? [])],
      owner: action.owner,
      target: action.target,
      input: action.input,
      output: action.output,
      defaultImplementation: action.defaultImplementation,
      overridden: bindingScope != null && bindingScope !== 'default',
      effectiveProviderKey,
      effectiveProviderOrigin,
      bindingScope,
    }
  }

  private _registerCoreProviders(): void {
    this._providerDisposers.push(this._implementations.registerProvider({
      key: FLOW_PROVIDER_KEY,
      origin: { kind: 'builtin', owner: '@endge/core' },
      execute: async (invocation) => {
        const action = invocation.executable.value as RAction
        const parentRuntimeId = String(invocation.context?.parentRuntimeId ?? '').trim()
        const parent = parentRuntimeId ? Endge.runtime.getRuntimeById(parentRuntimeId) : null
        const host = Endge.runtime.execute(action, { parent })
        if (!host || host.kind !== 'action')
          throw new Error(`Action runtime was not created: ${action.identity}.`)
        host.replaceContext({
          ...host.context,
          input: invocation.input != null && typeof invocation.input === 'object'
            ? invocation.input as Record<string, unknown>
            : (invocation.input === undefined ? {} : { input: invocation.input }),
        })
        await Endge.runtime.flow.run(host)
        return host.context.lastFlowResult
      },
    }))
    this._providerDisposers.push(this._implementations.registerProvider({
      key: COMPONENT_PORT_PROVIDER_KEY,
      origin: { kind: 'builtin', owner: '@endge/core' },
      execute: async (invocation) => {
        const action = invocation.executable.value as RAction
        const portName = action.defaultImplementation.kind === 'component-port'
          ? action.defaultImplementation.portName
          : action.identity
        const target = invocation.target?.value as Record<string, unknown> | undefined
        if (typeof target?.invokeAction === 'function')
          return await (target.invokeAction as Function)(portName, invocation.input)
        if (typeof target?.[portName] === 'function')
          return await (target[portName] as Function)(invocation.input)
        throw new Error(`Component target does not provide Action port: ${portName}.`)
      },
    }))
  }

  private _registerTableActions(): void {
    for (const legacy of createTableRuntimeActions()) {
      this._defineCodeAction({
        identity: legacy.id,
        displayName: legacy.label ?? legacy.id,
        description: legacy.description,
        owner: 'Table',
        target: [{ type: 'component.table' }],
        execute: invocation => legacy.execute(this._tableInvocationContext(invocation), invocation.input),
        canExecute: legacy.canExecute
          ? invocation => legacy.canExecute!(this._tableInvocationContext(invocation), invocation.input)
          : undefined,
      }, { kind: 'builtin', owner: 'Table' })
    }
  }

  /** Bridges typed Action invocation to the legacy context-menu adapter during migration. */
  private _tableInvocationContext(invocation: ImplementationInvocation): TableColumnActionContext {
    const context = invocation.context ?? {}
    const input = invocation.input != null && typeof invocation.input === 'object' && !Array.isArray(invocation.input)
      ? invocation.input as Record<string, unknown>
      : {}
    const merged = { ...context, ...input }
    const targetIdentity = invocation.target?.identity ?? String(merged.tableRuntimeId ?? merged.tableId ?? 'table')
    const pinState = merged.pinState === 'left' || merged.pinState === 'right' ? merged.pinState : 'none'
    const defaultPinState = merged.defaultPinState === 'left' || merged.defaultPinState === 'right' ? merged.defaultPinState : 'none'
    const sortMode = merged.sortMode === 'single' || merged.sortMode === 'fixed' || merged.sortMode === 'disabled'
      ? merged.sortMode
      : 'multiple'

    return {
      ...merged,
      surface: 'table-column-header',
      tableRuntimeId: String(merged.tableRuntimeId ?? targetIdentity),
      tableId: String(merged.tableId ?? targetIdentity),
      target: (invocation.target?.value ?? merged.target ?? {}) as TableColumnActionContext['target'],
      columnKey: String(merged.columnKey ?? ''),
      columnIndex: Number(merged.columnIndex ?? 0) || 0,
      hideable: merged.hideable !== false,
      pinnable: merged.pinnable !== false,
      pinMode: merged.pinMode === 'disabled' ? 'disabled' : 'enabled',
      pinState,
      defaultPinState,
      hasPinChanges: merged.hasPinChanges === true,
      sortable: merged.sortable !== false,
      sortMode,
      sortState: merged.sortState != null && typeof merged.sortState === 'object'
        ? merged.sortState as TableColumnActionContext['sortState']
        : { active: false },
      activeSortCount: Number(merged.activeSortCount ?? 0) || 0,
    }
  }

  private _registerCoreActions(): void {
    this._defineCodeAction({
      identity: BUILTIN_ACTION_IDS.consoleLog,
      displayName: 'Вывод в консоль',
      description: 'Выводит сообщение или input Action в консоль.',
      owner: '@endge/core',
      catalogPath: ['Debug'],
      execute: (invocation) => {
        const input = invocation.input
        const value = input != null
          && typeof input === 'object'
          && !Array.isArray(input)
          && 'message' in input
          ? (input as { message?: unknown }).message
          : input
        // eslint-disable-next-line no-console
        console.log(value ?? '[Endge] built-in-console-log executed')
      },
    }, { kind: 'builtin', owner: '@endge/core' })
    this._defineCodeAction({
      identity: 'load-vocabs',
      displayName: 'Загрузка справочников',
      description: 'Загружает справочники через Endge.vocabs.',
      owner: '@endge/core',
      execute: async (invocation) => {
        const raw = invocation.input
        const ids = Array.isArray(raw)
          ? raw
          : (raw != null && typeof raw === 'object' && Array.isArray((raw as { input?: unknown }).input)
              ? (raw as { input: unknown[] }).input
              : [])
        const normalized = ids.map(value => Number(value)).filter(Number.isFinite)
        await Promise.all(normalized.map(id => Endge.vocabs.loadById(id)))
      },
    }, { kind: 'builtin', owner: '@endge/core' })
  }

  private _syncResolvedIndex(): void {
    for (const action of this._codeActions.values())
      Endge.domain.resolved.set('action', action)
    this._hasSynchronizedResolvedIndex = true
  }

  private _legacyAction(identity: string): RuntimeAction {
    return {
      id: identity,
      label: this._findAction(identity)?.displayName ?? identity,
      canExecute: (context, payload) => this.canExecute(identity, context, payload),
      execute: (context, payload) => this.execute(identity, context, payload),
    }
  }

  private _isLegacyContext(value: ActionExecuteOptions | RuntimeActionContext): value is RuntimeActionContext {
    return typeof (value as RuntimeActionContext)?.surface === 'string'
  }

  private _legacyTarget(context: RuntimeActionContext): ActionExecutionTarget | undefined {
    if (context.target == null)
      return undefined
    return {
      type: context.surface.startsWith('table') ? 'component.table' : 'runtime',
      identity: String((context as unknown as Record<string, unknown>).tableRuntimeId ?? context.runtimeId ?? 'target'),
      value: context.target,
    }
  }
}
