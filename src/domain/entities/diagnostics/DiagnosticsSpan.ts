import type {
  DiagnosticsAttributes,
  DiagnosticsExceptionOptions,
  DiagnosticsInstrumentationScope,
  DiagnosticsLogInput,
  DiagnosticsLogRecord,
  DiagnosticsSpanEndOptions,
  DiagnosticsSpanHandle,
  DiagnosticsSpanOptions,
  DiagnosticsSpanOwner,
  DiagnosticsSpanRecord,
} from '@/domain/types/diagnostics'

/** Управляет одним активным span и завершает его через owner-модуль. */
export class DiagnosticsSpan implements DiagnosticsSpanHandle {
  private _ended = false
  private _attributes: DiagnosticsAttributes

  /** Создаёт handle с уже нормализованной correlation и scope. */
  public constructor(
    private readonly _owner: DiagnosticsSpanOwner,
    public readonly traceId: string,
    public readonly spanId: string,
    public readonly parentSpanId: string | undefined,
    private readonly _traceFlags: number | undefined,
    private readonly _name: string,
    private readonly _scope: DiagnosticsInstrumentationScope,
    private readonly _startTimestamp: number,
    attributes: DiagnosticsAttributes,
  ) {
    this._attributes = { ...attributes }
  }

  /** Показывает, был ли span уже завершён. */
  public get isEnded(): boolean {
    return this._ended
  }

  /** Добавляет или заменяет структурированные атрибуты активного span. */
  public setAttributes(attributes: DiagnosticsAttributes): void {
    if (this._ended)
      return
    this._attributes = { ...this._attributes, ...attributes }
  }

  /** Создаёт дочерний span с correlation текущего handle. */
  public startChild(
    name: string,
    options: Omit<DiagnosticsSpanOptions, 'traceId' | 'parentSpanId'> = {},
  ): DiagnosticsSpanHandle {
    return this._owner.startSpan(name, {
      ...options,
      traceId: this.traceId,
      parentSpanId: this.spanId,
      traceFlags: options.traceFlags ?? this._traceFlags,
      scope: options.scope ?? this._scope,
    })
  }

  /** Записывает log с автоматической correlation текущего span. */
  public log(input: Omit<DiagnosticsLogInput, 'traceId' | 'spanId'>): DiagnosticsLogRecord | null {
    return this._owner.log({
      ...input,
      traceId: this.traceId,
      spanId: this.spanId,
      traceFlags: input.traceFlags ?? this._traceFlags,
      scope: input.scope ?? this._scope,
    })
  }

  /** Записывает exception как связанный ERROR/FATAL log. */
  public recordException(error: unknown, options: DiagnosticsExceptionOptions = {}): DiagnosticsLogRecord | null {
    return this._owner.recordException(error, {
      ...options,
      traceId: this.traceId,
      spanId: this.spanId,
      traceFlags: options.traceFlags ?? this._traceFlags,
      scope: options.scope ?? this._scope,
    })
  }

  /** Идемпотентно завершает span и возвращает сохранённый record. */
  public end(options: DiagnosticsSpanEndOptions = {}): DiagnosticsSpanRecord | null {
    if (this._ended)
      return null

    this._ended = true
    return this._owner.finishSpan({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      traceFlags: this._traceFlags,
      name: this._name,
      scope: this._scope,
      startTimestamp: this._startTimestamp,
      attributes: this._attributes,
      options,
    })
  }
}
