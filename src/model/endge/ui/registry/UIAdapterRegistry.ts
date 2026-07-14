import type {
  UIActiveRenderAdapterRequirement,
  UIRenderAdapter,
  UIRenderAdapterDescriptor,
  UIRenderAdapterRequirement,
} from '@/domain/types/ui/ui-render-adapter.type'

/** Хранит runtime implementations UI adapter-ов и выбранный adapter. */
export class UIAdapterRegistry {
  private _adapters = new Map<string, UIRenderAdapter>()
  private _activeAdapterId: string | null = null

  public constructor(private readonly _onChange: () => void = () => {}) {}

  /** Регистрирует adapter и запрещает неявную замену implementation с тем же id. */
  public register<TImplementation>(input: UIRenderAdapter<TImplementation>): UIRenderAdapter<TImplementation> {
    const adapter = this._normalizeAdapter(input)
    if (this._adapters.has(adapter.id)) {
      throw new Error(`[UIAdapterRegistry] adapter "${adapter.id}" is already registered`)
    }

    this._adapters.set(adapter.id, adapter as UIRenderAdapter)
    this._onChange()

    return adapter
  }

  /** Проверяет наличие adapter-а по id. */
  public has(id: string | null | undefined): boolean {
    return this._adapters.has(String(id ?? '').trim())
  }

  /** Возвращает adapter по id без проверки его контракта. */
  public get<TImplementation = unknown>(id: string | null | undefined): UIRenderAdapter<TImplementation> | null {
    const adapter = this._adapters.get(String(id ?? '').trim())
    return (adapter as UIRenderAdapter<TImplementation> | undefined) ?? null
  }

  /** Возвращает adapter и проверяет его protocol, renderer и обязательные renderer keys. */
  public require<TImplementation = unknown>(requirement: UIRenderAdapterRequirement): UIRenderAdapter<TImplementation> {
    const id = String(requirement.id ?? '').trim()
    const adapter = this.get<TImplementation>(id)
    if (!adapter) {
      const registered = [...this._adapters.keys()].join(', ') || 'none'
      throw new Error(
        `[UIAdapterRegistry] adapter "${id || '<empty>'}" is not registered. Registered adapters: ${registered}`,
      )
    }

    this._assertRequirement(adapter, requirement)
    return adapter
  }

  /** Проверяет и делает adapter активным для текущего workspace runtime. */
  public activate<TImplementation = unknown>(
    input: string | UIRenderAdapterRequirement,
  ): UIRenderAdapter<TImplementation> {
    const requirement = typeof input === 'string' ? { id: input } : input
    const adapter = this.require<TImplementation>(requirement)

    if (this._activeAdapterId !== adapter.id) {
      this._activeAdapterId = adapter.id
      this._onChange()
    }

    return adapter
  }

  /** Возвращает активный adapter без проверки consumer-контракта. */
  public get active(): UIRenderAdapter | null {
    return this.get(this._activeAdapterId)
  }

  /** Возвращает активный adapter и проверяет его consumer-контракт. */
  public requireActive<TImplementation = unknown>(
    requirement: UIActiveRenderAdapterRequirement = {},
  ): UIRenderAdapter<TImplementation> {
    if (!this._activeAdapterId) {
      throw new Error('[UIAdapterRegistry] active adapter is not selected')
    }

    return this.require<TImplementation>({
      ...requirement,
      id: this._activeAdapterId,
    })
  }

  /** Возвращает сериализуемые descriptors всех зарегистрированных adapter-ов. */
  public list(): UIRenderAdapterDescriptor[] {
    return [...this._adapters.values()].map(adapter => ({
      id: adapter.id,
      protocol: adapter.protocol,
      protocolVersion: adapter.protocolVersion,
      renderer: adapter.renderer,
      rendererKeys: Object.keys(adapter.renderers),
    }))
  }

  /** Очищает runtime registrations и active adapter. */
  public reset(): void {
    const changed = this._adapters.size > 0 || this._activeAdapterId !== null
    this._adapters.clear()
    this._activeAdapterId = null
    if (changed) this._onChange()
  }

  /** Нормализует descriptor, сохраняя runtime implementations без сериализации. */
  private _normalizeAdapter<TImplementation>(
    input: UIRenderAdapter<TImplementation>,
  ): UIRenderAdapter<TImplementation> {
    const id = String(input?.id ?? '').trim()
    const protocol = String(input?.protocol ?? '').trim()
    const renderer = String(input?.renderer ?? '').trim()
    const protocolVersion = Number(input?.protocolVersion)
    const renderers = input?.renderers

    if (!id) throw new Error('[UIAdapterRegistry] adapter id is required')
    if (!protocol) throw new Error(`[UIAdapterRegistry] adapter "${id}" protocol is required`)
    if (!renderer) throw new Error(`[UIAdapterRegistry] adapter "${id}" renderer is required`)
    if (!Number.isInteger(protocolVersion) || protocolVersion < 1) {
      throw new Error(`[UIAdapterRegistry] adapter "${id}" protocolVersion must be a positive integer`)
    }
    if (!renderers || typeof renderers !== 'object' || Array.isArray(renderers)) {
      throw new Error(`[UIAdapterRegistry] adapter "${id}" renderers must be an object`)
    }

    const normalizedRenderers = { ...renderers }
    for (const [key, implementation] of Object.entries(normalizedRenderers)) {
      if (!key.trim()) throw new Error(`[UIAdapterRegistry] adapter "${id}" contains an empty renderer key`)
      if (implementation == null) {
        throw new Error(`[UIAdapterRegistry] adapter "${id}" renderer "${key}" has no implementation`)
      }
    }

    return {
      id,
      protocol,
      protocolVersion,
      renderer,
      renderers: normalizedRenderers,
    }
  }

  /** Проверяет совместимость adapter-а с контрактом конкретного render engine. */
  private _assertRequirement(
    adapter: UIRenderAdapter,
    requirement: UIRenderAdapterRequirement,
  ): void {
    if (requirement.protocol && adapter.protocol !== requirement.protocol) {
      throw new Error(
        `[UIAdapterRegistry] adapter "${adapter.id}" uses protocol "${adapter.protocol}", expected "${requirement.protocol}"`,
      )
    }
    if (requirement.protocolVersion != null && adapter.protocolVersion !== requirement.protocolVersion) {
      throw new Error(
        `[UIAdapterRegistry] adapter "${adapter.id}" uses protocol version ${adapter.protocolVersion}, expected ${requirement.protocolVersion}`,
      )
    }
    if (requirement.renderer && adapter.renderer !== requirement.renderer) {
      throw new Error(
        `[UIAdapterRegistry] adapter "${adapter.id}" uses renderer "${adapter.renderer}", expected "${requirement.renderer}"`,
      )
    }

    const missingKeys = (requirement.requiredRendererKeys ?? [])
      .filter(key => !(key in adapter.renderers))
    if (missingKeys.length > 0) {
      throw new Error(
        `[UIAdapterRegistry] adapter "${adapter.id}" is missing renderers: ${missingKeys.join(', ')}`,
      )
    }
  }
}
