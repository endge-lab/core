import type {
  DiagnosticsAttrs,
  DiagnosticsContextRef,
  DiagnosticsEventOptions,
  DiagnosticsLevel,
  DiagnosticsMeasurementOptions,
  DiagnosticsScopeOptions,
  DiagnosticsScopeWriter,
  DiagnosticsSnapshotOptions,
} from '@/domain/types/diagnostics/diagnostics.types'

export abstract class DiagnosticsScopeHandle {
  protected _closed = false

  protected constructor(
    protected readonly diagnostics: DiagnosticsScopeWriter,
    protected readonly active: boolean,
    protected readonly traceId: string,
    protected readonly spanId: string | undefined,
    protected readonly channel: string | undefined,
    protected readonly level: DiagnosticsLevel,
    protected readonly startedAt: number,
    protected readonly attrs: DiagnosticsAttrs | undefined,
    protected readonly entities: DiagnosticsScopeOptions['entities'],
    protected readonly context: DiagnosticsContextRef | undefined,
  ) {}

  public get isActive(): boolean {
    return this.active && !this._closed
  }

  public event(message: string, options: DiagnosticsEventOptions = {}): void {
    if (!this.isActive)
      return

    this.diagnostics.writeEvent({
      message,
      level: options.level ?? this.level,
      channel: this.normalizeChannel(options.channel) ?? this.channel,
      attrs: {
        ...(this.attrs ?? {}),
        ...(options.attrs ?? {}),
      },
      entities: options.entities ?? this.entities,
      context: this.mergeContext(this.context, options.context),
      traceId: this.traceId,
      spanId: this.spanId,
      data: options.data,
      error: options.error,
    })
  }

  public measurement(name: string, value: number, options: DiagnosticsMeasurementOptions = {}): void {
    if (!this.isActive)
      return

    this.diagnostics.writeMeasurement({
      name,
      value,
      unit: options.unit,
      level: options.level ?? this.level,
      channel: this.normalizeChannel(options.channel) ?? this.channel,
      attrs: {
        ...(this.attrs ?? {}),
        ...(options.attrs ?? {}),
      },
      entities: options.entities ?? this.entities,
      context: this.mergeContext(this.context, options.context),
      traceId: this.traceId,
      spanId: this.spanId,
    })
  }

  public snapshot(name: string, options: DiagnosticsSnapshotOptions = {}): void {
    if (!this.isActive)
      return

    this.diagnostics.writeSnapshot({
      name,
      payload: options.payload,
      level: options.level ?? this.level,
      channel: this.normalizeChannel(options.channel) ?? this.channel,
      attrs: {
        ...(this.attrs ?? {}),
        ...(options.attrs ?? {}),
      },
      entities: options.entities ?? this.entities,
      context: this.mergeContext(this.context, options.context),
      traceId: this.traceId,
      spanId: this.spanId,
    })
  }

  protected mergeContext(
    base: DiagnosticsContextRef | undefined,
    patch: Partial<DiagnosticsContextRef> | undefined,
  ): DiagnosticsContextRef | undefined {
    const out: DiagnosticsContextRef = {
      ...(base ?? {}),
      ...(patch ?? {}),
    }

    if (!out.sessionId)
      out.sessionId = this.diagnostics.sessionId

    return Object.values(out).some(value => value != null && String(value).trim() !== '')
      ? out
      : undefined
  }

  protected normalizeChannel(value: string | undefined): string | undefined {
    const next = String(value ?? '').trim()
    return next || undefined
  }
}
