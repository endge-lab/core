import type { ComponentSFCRuntimeHost } from '@/domain/entities/runtime/hosts/ComponentSFCRuntimeHost'
import type {
  ComponentSFCEventPort,
  ComponentSFCEventRuntimeSource,
  ComponentSFCPortManifest,
} from '@/domain/types/component/sfc'

/** Mount-scoped Event router for one Component SFC artifact boundary. */
export class ComponentSFCEventBoundary {
  public constructor(
    private readonly host: ComponentSFCRuntimeHost | null,
    public readonly componentIdentity: string,
    private readonly manifest: ComponentSFCPortManifest,
    private readonly parent: ComponentSFCEventBoundary | null = null,
    private readonly parentSource?: ComponentSFCEventRuntimeSource,
  ) {}

  public createChild(
    componentIdentity: string,
    manifest: ComponentSFCPortManifest,
    source: ComponentSFCEventRuntimeSource,
  ): ComponentSFCEventBoundary {
    return new ComponentSFCEventBoundary(this.host, componentIdentity, manifest, this, source)
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
    if (!port) throw new Error(`Own Component Event is not declared: ${this.componentIdentity}.${name}.`)
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
    if (this.parent && this.parentSource)
      void this.parent.emitChild(forwardedSource!, port.name, payload, trace, depth + 1).catch(error => this.reportError(port, error))
    else
      this.host?.publishEventPort(port.name, payload, source)

    await this.host?.executeEventPortAction(
      this.componentIdentity,
      port,
      payload,
      source,
      (event, nextPayload, nextTrace, nextDepth) => this.emitOwn(event, nextPayload, nextTrace, nextDepth),
      trace,
      depth,
    )
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
  if (!origin || origin.portName !== event) return false
  if (origin.nodeId && origin.nodeId === source.nodeId) return true
  return Boolean(origin.ref && source.ref && origin.ref === source.ref)
}
