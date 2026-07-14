import { DiagnosticsScopeHandle } from '@/domain/entities/diagnostics/DiagnosticsScopeHandle'
import { DiagnosticsSpan } from '@/domain/entities/diagnostics/DiagnosticsSpan'
import type {
  DiagnosticsAttrs,
  DiagnosticsContextRef,
  DiagnosticsLevel,
  DiagnosticsScopeOptions,
  DiagnosticsTraceOwner,
} from '@/domain/types/diagnostics/diagnostics.types'

export class DiagnosticsTrace extends DiagnosticsScopeHandle {
  private readonly _name: string

  public constructor(
    diagnostics: DiagnosticsTraceOwner,
    active: boolean,
    traceId: string,
    name: string,
    channel: string | undefined,
    level: DiagnosticsLevel,
    startedAt: number,
    attrs: DiagnosticsAttrs | undefined,
    entities: DiagnosticsScopeOptions['entities'],
    context: DiagnosticsContextRef | undefined,
  ) {
    super(diagnostics, active, traceId, undefined, channel, level, startedAt, attrs, entities, context)
    this._name = name
  }

  public span(name: string, options: DiagnosticsScopeOptions = {}): DiagnosticsSpan {
    const diagnostics = this.diagnostics as DiagnosticsTraceOwner

    if (!this.isActive)
      return diagnostics.createInactiveSpan(this.traceId, undefined)

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
    })
  }

  public end(attrs?: DiagnosticsAttrs): void {
    if (!this.isActive) {
      this._closed = true
      return
    }

    const diagnostics = this.diagnostics as DiagnosticsTraceOwner
    const endedAt = Date.now()

    diagnostics.writeTraceEnd({
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
      durMs: Math.max(0, endedAt - this.startedAt),
    })
    this._closed = true
  }
}
