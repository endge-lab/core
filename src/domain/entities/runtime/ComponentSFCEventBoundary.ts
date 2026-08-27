import type { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import type { RComponentSFC_IR_EventBinding } from '@/domain/types/component/sfc/ir.types'
import type {
  ComponentSFCEventAction,
  ComponentSFCEventPort,
  ComponentSFCEventRuntimeSource,
  ComponentSFCPortManifest,
  ComponentSFCRequiredPortBinding,
} from '@/domain/types/component/sfc/ports.types'

/** Mount-scoped Event router for one Component SFC artifact boundary. */
export class ComponentSFCEventBoundary {
  private readonly consumedLocalOnce = new Set<string>()

  public constructor(
    private readonly host: ComponentSFCRuntimeHost | null,
    public readonly componentIdentity: string,
    private readonly manifest: ComponentSFCPortManifest,
    private readonly parent: ComponentSFCEventBoundary | null = null,
    private readonly parentSource?: ComponentSFCEventRuntimeSource,
    private readonly parentBindings: readonly RComponentSFC_IR_EventBinding[] = [],
    private readonly parentEventTransform?: (event: string, payload: unknown) => { event: string, payload: unknown } | null,
    private readonly requiredPortBindings: readonly ComponentSFCRequiredPortBinding[] = [],
  ) {}

  public createChild(
    componentIdentity: string,
    manifest: ComponentSFCPortManifest,
    source: ComponentSFCEventRuntimeSource,
    bindings: readonly RComponentSFC_IR_EventBinding[] = [],
    transform?: (event: string, payload: unknown) => { event: string, payload: unknown } | null,
    requiredPortBindings: readonly ComponentSFCRequiredPortBinding[] = [],
  ): ComponentSFCEventBoundary {
    return new ComponentSFCEventBoundary(this.host, componentIdentity, manifest, this, source, bindings, transform, requiredPortBindings)
  }

  /** True when the current public manifest observes one Event of this child source. */
  public observesChild(source: ComponentSFCEventRuntimeSource, event: string): boolean {
    return this.manifest.emits.events.some(port => matchesSource(port, source, event))
  }

  /** Claims a mount-scoped logical `.once` rule after it has matched. */
  public claimLocalOnce(key: string): boolean {
    if (this.consumedLocalOnce.has(key)) {
      return false
    }
    this.consumedLocalOnce.add(key)
    return true
  }

  /** Runs local `@event` reactions, then routes the occurrence unless `.stop` is present. */
  public async routeChild(
    source: ComponentSFCEventRuntimeSource,
    event: string,
    payload: unknown,
    bindings: readonly RComponentSFC_IR_EventBinding[] = [],
    trace: string[] = [],
    depth = 0,
    scope: Record<string, unknown> = {},
  ): Promise<void> {
    const local = bindings.flatMap((binding, index) => {
      if (binding.name !== event) {
        return []
      }
      if (!binding.modifiers.includes('once')) {
        return [binding]
      }
      const key = `${source.nodeId}:${event}:${binding.sourceRange?.start ?? index}`
      if (!this.claimLocalOnce(key)) {
        return []
      }
      return [binding]
    })
    const reactions = local.map(async (binding) => {
      for (const action of binding.actions?.length ? binding.actions : [binding.action]) {
        const succeeded = await this.host?.executeEventPortAction(
          this.componentIdentity,
          {
            kind: 'event',
            role: 'emits',
            name: `${source.nodeId}:${event}`,
            payloadType: 'unknown',
            action: this.resolveRequiredPortAction(action),
          },
          payload,
          source,
          (name, nextPayload, nextTrace, nextDepth) => this.emitOwn(name, nextPayload, nextTrace, nextDepth),
          trace,
          depth,
          scope,
        )
        if (succeeded === false) {
          break
        }
      }
    })
    const routed = local.some(binding => binding.modifiers.includes('stop'))
      ? Promise.resolve()
      : this.emitChild(source, event, payload, trace, depth)
    await Promise.allSettled([...reactions.filter(Boolean), routed] as Promise<unknown>[])
  }

  /** Receives an intrinsic or nested child occurrence and resolves public ports by origin. */
  public async emitChild(
    source: ComponentSFCEventRuntimeSource,
    event: string,
    payload: unknown,
    trace: string[] = [],
    depth = 0,
  ): Promise<void> {
    const ports = this.manifest.emits.events.filter(port => matchesSource(port, source, event))
    await Promise.all(ports.map(port => this.dispatch(port, payload, source, trace, depth)))
  }

  /** Emits an Event declared as own by this component. */
  public async emitOwn(name: string, payload: unknown, trace: string[] = [], depth = 0): Promise<void> {
    const port = this.manifest.emits.events.find(candidate => candidate.name === name && !candidate.from && !candidate.forwardedFrom)
    if (!port) {
      throw new Error(`Own Component Event is not declared: ${this.componentIdentity}.${name}.`)
    }
    await this.dispatch(port, payload, undefined, trace, depth)
  }

  private async dispatch(
    port: ComponentSFCEventPort,
    payload: unknown,
    source: ComponentSFCEventRuntimeSource | undefined,
    trace: string[],
    depth: number,
  ): Promise<void> {
    if (depth >= 32) {
      this.host?.emit('event:error', { code: 'event-depth-limit', componentIdentity: this.componentIdentity, event: port.name })
      return
    }

    const forwardedSource = this.parentSource
      ? { ...this.parentSource, target: source?.target ?? this.parentSource.target }
      : source
    if (this.parent && this.parentSource) {
      const transformed = this.parentEventTransform
        ? this.parentEventTransform(port.name, payload)
        : { event: port.name, payload }
      if (transformed) {
        void this.parent.routeChild(forwardedSource!, transformed.event, transformed.payload, this.parentBindings, trace, depth + 1).catch(error => this.reportError(port, error))
      }
    }
    else {
      this.host?.publishEventPort(port.name, payload, source)
    }

    await this.host?.executeEventPortAction(
      this.componentIdentity,
      port.action?.kind === 'required-port'
        ? { ...port, action: this.resolveRequiredPortAction(port.action) }
        : port,
      payload,
      source,
      (event, nextPayload, nextTrace, nextDepth) => this.emitOwn(event, nextPayload, nextTrace, nextDepth),
      trace,
      depth,
    )
  }

  private resolveRequiredPortAction(action: ComponentSFCEventAction): ComponentSFCEventAction {
    if (action.kind !== 'required-port') {
      return action
    }
    const declared = action.portKind === 'query'
      ? this.manifest.require.queries.find(port => port.name === action.port)
      : this.manifest.require.actions.find(port => port.name === action.port)
    if (!declared) {
      throw new Error(`Required ${action.portKind} port is not declared: ${this.componentIdentity}.${action.port}.`)
    }
    const binding = this.requiredPortBindings.find(candidate => candidate.port === action.port)
    const identity = binding?.identity ?? declared.defaultIdentity
    if (!identity) {
      throw new Error(`Required ${action.portKind} port has no provider: ${this.componentIdentity}.${action.port}.`)
    }
    return {
      kind: action.portKind,
      identity,
      ...(action.input ? { input: action.input } : {}),
    }
  }

  private reportError(port: ComponentSFCEventPort, error: unknown): void {
    this.host?.emit('event:error', {
      code: 'event-forward-error',
      componentIdentity: this.componentIdentity,
      event: port.name,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

function matchesSource(
  port: ComponentSFCEventPort,
  source: ComponentSFCEventRuntimeSource,
  event: string,
): boolean {
  const origin = port.forwardedFrom
  if (!origin || origin.portName !== event) {
    return false
  }
  if (origin.nodeId && origin.nodeId === source.nodeId) {
    return true
  }
  return Boolean(origin.ref && source.ref && origin.ref === source.ref)
}
