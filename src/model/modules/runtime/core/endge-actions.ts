import { RField } from '@/domain/entities/reflect/RField'
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
import type { EntityOrigin } from '@/domain/types/document/entity-management.type'
import { Subscribable } from '@endge/utils'
import { Endge } from '@/model/kernel/endge'
import { EndgeImplementations } from '@/model/modules/runtime/implementation/endge-implementations'
import { normalizeActionTargets, validateActionTarget } from '@/model/services/compiler/action/action-target-validation'
import { createTableRuntimeActions } from '@/model/services/runtime/table-actions'
import { ActionProgramExecutor } from '@/model/modules/runtime/execution/action/action-program-executor'

const SOURCE_PROVIDER_KEY = 'core.action.source'
const COMPONENT_PORT_PROVIDER_KEY = 'core.action.component-port'

export interface CodeActionDefinition extends Omit<ActionDefinitionInput, 'owner'> {
  owner: string
  catalogPath?: readonly string[]
  providerKey?: string
  execute?: ImplementationProvider['execute']
  canExecute?: ImplementationProvider['canExecute']
}

export interface ActionOverrideInput {
  identity: string
  providerKey: string
  scope?: Exclude<ImplementationBindingScope, 'default' | 'invocation'>
  scopeIdentity?: string
  priority?: number
}

export interface ActionDefinitionDescriptor extends ActionDefinitionInput {
  origin: EntityOrigin
  catalogPath?: readonly string[]
}

export interface ActionProviderDescriptor extends Omit<ImplementationProvider, 'contract'> {
  identity: string
}

/** Action-specific facade over semantic definitions and generic implementations. */
export class EndgeActions extends Subscribable {
  private readonly _codeActions = new Map<string, RAction>()
  private readonly _catalogPaths = new Map<string, string[]>()
  private readonly _codeActionDisposers = new Map<string, () => void>()
  private readonly _providerDisposers: Array<() => void> = []
  private _hasSynchronizedResolvedIndex = false
  private readonly _sourceExecutor = new ActionProgramExecutor()

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
    for (const dispose of [...this._codeActionDisposers.values()]) dispose()
    this._providerDisposers.splice(0).forEach(dispose => dispose())
    this._codeActions.clear()
    this._catalogPaths.clear()
    this._codeActionDisposers.clear()
    this._registerCoreProviders()
    this._registerCoreActions()
    this._registerTableActions()
    this.notify()
  }

  /** Installs a serializable code-owned semantic definition without executable code. */
  public define(definition: ActionDefinitionDescriptor): () => void {
    if (this._findAction(definition.identity))
      throw new Error(`Action identity collision: ${definition.identity}. Use Endge.actions.override() explicitly.`)
    const owner = definition.origin.kind === 'derived'
      ? definition.origin.source.identity
      : definition.origin.kind === 'storage'
        ? 'storage'
        : definition.origin.owner
    return this._defineCodeAction({ ...definition, owner }, definition.origin)
  }

  /** Installs executable code separately from its semantic definition. */
  public provide(provider: ActionProviderDescriptor): () => void {
    const action = this._findAction(provider.identity)
    if (!action) throw new Error(`Action provider requires an existing definition: ${provider.identity}.`)
    return this._implementations.registerProvider({
      key: provider.key,
      origin: provider.origin,
      active: provider.active,
      contract: this._contractOf(action),
      execute: provider.execute,
      canExecute: provider.canExecute,
    })
  }

  /** Binds local code over an existing Action without mutating its definition. */
  public override(override: ActionOverrideInput): () => void {
    const action = this._findAction(override.identity)
    if (!action)
      throw new Error(`Action cannot be overridden because it does not exist: ${override.identity}.`)
    if (!this._implementations.hasProvider(override.providerKey))
      throw new Error(`Action provider is not registered: ${override.providerKey}.`)
    const disposeBinding = this._implementations.bind({
      executableType: 'action',
      executableIdentity: override.identity,
      providerKey: override.providerKey,
      scope: override.scope ?? 'application',
      scopeIdentity: override.scopeIdentity,
      priority: override.priority,
    })
    this.notify()
    return () => {
      disposeBinding()
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

    const providerKey = definition.defaultProviderKey ?? definition.providerKey ?? `${origin.kind}.${definition.owner}.${identity}`
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
    action.contract = {
      input: definition.contract?.input ?? null,
      output: definition.contract?.output ?? null,
    }
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
    if (action.defaultImplementation.kind === 'source') return SOURCE_PROVIDER_KEY
    if (action.defaultImplementation.kind === 'component-port') return COMPONENT_PORT_PROVIDER_KEY
    return action.defaultImplementation.kind === 'provider' ? action.defaultImplementation.providerKey : null
  }

  private _contractOf(action: RAction) {
    return {
      target: normalizeActionTargets(action.target),
      input: action.contract.input,
      output: action.contract.output,
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
      input: action.contract.input,
      output: action.contract.output,
      defaultImplementation: action.defaultImplementation,
      overridden: bindingScope != null && bindingScope !== 'default',
      effectiveProviderKey,
      effectiveProviderOrigin,
      bindingScope,
    }
  }

  private _registerCoreProviders(): void {
    this._providerDisposers.push(this._implementations.registerProvider({
      key: SOURCE_PROVIDER_KEY,
      origin: { kind: 'builtin', owner: '@endge/core' },
      execute: async (invocation) => {
        const action = invocation.executable.value as RAction
        const parentRuntimeId = String(invocation.context?.parentRuntimeId ?? '').trim()
        const parent = parentRuntimeId ? Endge.runtime.getRuntimeById(parentRuntimeId) : null
        const artifact = Endge.program.getActionArtifact(action.identity)
        if (!artifact || artifact.status === 'error') throw new Error(`Action artifact is not executable: ${action.identity}.`)
        return await this._sourceExecutor.run(artifact.payload, invocation.input, parent)
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
        console.log(formatConsoleActionValue(value))
      },
    }, { kind: 'builtin', owner: '@endge/core' })
    this._defineCodeAction({
      identity: BUILTIN_ACTION_IDS.testAlert,
      displayName: 'Test alert',
      description: 'Показывает фиксированное тестовое сообщение в браузере.',
      owner: '@endge/core',
      catalogPath: ['Debug'],
      execute: () => {
        if (typeof globalThis.alert === 'function')
          globalThis.alert('Test alert')
      },
    }, { kind: 'builtin', owner: '@endge/core' })
    const vocabActions: Array<CodeActionDefinition> = [
      {
        identity: BUILTIN_ACTION_IDS.vocabAcquire,
        displayName: 'Загрузить справочники',
        description: 'Загружает только отсутствующие в runtime cache справочники.',
        owner: '@endge/core',
        catalogPath: ['Справочники'],
        contract: { input: new RField('vocabs', 'RefVocab', true) },
        execute: invocation => Endge.vocabs.acquire(this._vocabReferences(invocation.input)),
      },
      {
        identity: BUILTIN_ACTION_IDS.vocabRefresh,
        displayName: 'Обновить справочники',
        description: 'Принудительно загружает свежие значения справочников.',
        owner: '@endge/core',
        catalogPath: ['Справочники'],
        contract: { input: new RField('vocabs', 'RefVocab', true) },
        execute: invocation => Endge.vocabs.refresh(this._vocabReferences(invocation.input)),
      },
      {
        identity: BUILTIN_ACTION_IDS.vocabInvalidate,
        displayName: 'Очистить кеш справочников',
        description: 'Удаляет значения справочников из runtime cache без сетевого запроса.',
        owner: '@endge/core',
        catalogPath: ['Справочники'],
        contract: { input: new RField('vocabs', 'RefVocab', true) },
        execute: invocation => Endge.vocabs.invalidate(this._vocabReferences(invocation.input)),
      },
    ]
    for (const definition of vocabActions)
      this._defineCodeAction(definition, { kind: 'builtin', owner: '@endge/core' })
  }

  private _vocabReferences(input: unknown): Array<string | number> {
    const raw = Array.isArray(input)
      ? input
      : (input != null && typeof input === 'object'
          ? ((input as { vocabs?: unknown }).vocabs ?? (input as { input?: unknown }).input)
          : input)
    const values = Array.isArray(raw) ? raw : (raw == null ? [] : [raw])
    return values.filter((value): value is string | number =>
      (typeof value === 'string' && value.trim().length > 0)
      || (typeof value === 'number' && Number.isFinite(value)),
    )
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

function formatConsoleActionValue(value: unknown): string {
  if (value == null)
    return '[Endge] built-in-console-log executed'
  if (typeof value === 'string')
    return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return String(value)
  if (Array.isArray(value))
    return `[Endge] Array(${value.length}) omitted from Console to avoid retaining runtime data.`
  return `[Endge] ${typeof value === 'object' ? 'Object' : typeof value} omitted from Console to avoid retaining runtime data.`
}
