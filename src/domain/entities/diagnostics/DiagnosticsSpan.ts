import { DiagnosticsScopeHandle } from '@/domain/entities/diagnostics/DiagnosticsScopeHandle'
import type {
  DiagnosticsAttrs,
  DiagnosticsContextRef,
  DiagnosticsLevel,
  DiagnosticsScopeOptions,
  DiagnosticsSpanOwner,
} from '@/domain/types/diagnostics.types'

export class DiagnosticsSpan extends DiagnosticsScopeHandle {
  private readonly _name: string
  private readonly _parentSpanId: string | undefined

  public constructor(
    diagnostics: DiagnosticsSpanOwner,
    active: boolean,
    traceId: string,
    spanId: string | undefined,
    parentSpanId: string | undefined,
    name: string,
    channel: string | undefined,
    level: DiagnosticsLevel,
    startedAt: number,
    attrs: DiagnosticsAttrs | undefined,
    entities: DiagnosticsScopeOptions['entities'],
    context: DiagnosticsContextRef | undefined,
  ) {
    super(diagnostics, active, traceId, spanId, channel, level, startedAt, attrs, entities, context)
    this._name = name
    this._parentSpanId = parentSpanId
  }

  public span(name: string, options: DiagnosticsScopeOptions = {}): DiagnosticsSpan {
    const diagnostics = this.diagnostics as DiagnosticsSpanOwner

    if (!this.isActive)
      return diagnostics.createInactiveSpan(this.traceId, this.spanId)

    return diagnostics.startSpan(name, {
      ...options,
      channel: this.normalizeChannel(options.channel) ?? this.channel,
      context: this.mergeContext(this.context, options.context),
      attrs: {
        ...(this.attrs ?? {}),
        ...(options.attrs ?? {}),
      },
      entities: options.entities ?? this.entities,
      traceId: this.traceId,
      parentSpanId: this.spanId,
    })
  }

  public end(attrs?: DiagnosticsAttrs): void {
    if (!this.isActive) {
      this._closed = true
      return
    }

    const diagnostics = this.diagnostics as DiagnosticsSpanOwner
    const endedAt = Date.now()

    diagnostics.writeSpanEnd({
      name: this._name,
      level: this.level,
      channel: this.channel,
      attrs: {
        ...(this.attrs ?? {}),
        ...(attrs ?? {}),
      },
      entities: this.entities,
      context: this.context,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this._parentSpanId,
      durMs: Math.max(0, endedAt - this.startedAt),
    })
    this._closed = true
  }
}
