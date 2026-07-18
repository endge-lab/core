import type {
  DiagnosticsAdapter,
  DiagnosticsAdapterCreateContext,
  DiagnosticsAdapterFactory,
  EndgeDiagnosticsOutputConfiguration,
} from '@/domain/types/diagnostics'

/** Реестр расширяемых типов diagnostics adapters. */
export class DiagnosticsAdapterRegistry {
  private readonly _factories = new Map<string, DiagnosticsAdapterFactory>()
  private readonly _listeners = new Set<() => void>()

  /** Регистрирует factory по стабильному adapter type и возвращает функцию удаления. */
  public register(factory: DiagnosticsAdapterFactory): () => void {
    const type = String(factory.type ?? '').trim()
    if (!type)
      throw new Error('[EndgeDiagnostics] Adapter factory type is required')
    if (this._factories.has(type))
      throw new Error(`[EndgeDiagnostics] Adapter factory "${type}" is already registered`)

    this._factories.set(type, factory)
    this._notify()
    return () => {
      if (this._factories.get(type) !== factory)
        return
      this._factories.delete(type)
      this._notify()
    }
  }

  /** Возвращает factory зарегистрированного adapter type. */
  public get(type: string): DiagnosticsAdapterFactory | undefined {
    return this._factories.get(String(type ?? '').trim())
  }

  /** Возвращает список зарегистрированных adapter types. */
  public list(): readonly DiagnosticsAdapterFactory[] {
    return [...this._factories.values()]
  }

  /** Создаёт runtime adapter для одного output или возвращает null для неизвестного type. */
  public create(
    output: EndgeDiagnosticsOutputConfiguration,
    context: DiagnosticsAdapterCreateContext,
  ): DiagnosticsAdapter | null {
    return this.get(output.adapterType)?.create(output, context) ?? null
  }

  /** Подписывает listener на изменения состава factories. */
  public subscribe(listener: () => void): () => void {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  /** Уведомляет владельца runtime adapters о необходимости пересборки. */
  private _notify(): void {
    for (const listener of this._listeners)
      listener()
  }
}
