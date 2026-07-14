import type {
  EndgeMockBindingStatus,
  EndgeMockDescriptor,
  EndgeMockProvider,
  EndgeMockRegistration,
  EndgeMockSnapshot,
} from '@/domain/types/mock'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/kernel/endge'

/** Runtime resolver persisted mock-документов и подключенных code providers. */
export class EndgeMock extends EndgeModule {
  private readonly _providers = new Map<string, EndgeMockProvider>()

  /** Создает пустой registry для application providers. */
  public constructor() {
    super()
    this.reset()
  }

  /** Регистрирует provider по namespaced ref и запрещает неявную замену. */
  public registerProvider(provider: EndgeMockProvider): void {
    const normalized = normalizeProvider(provider)
    if (this._providers.has(normalized.ref))
      throw new Error(`[EndgeMock] Provider "${normalized.ref}" is already registered.`)

    this._providers.set(normalized.ref, normalized)
    this.notify()
  }

  /**
   * Compatibility adapter старого data registration.
   * Он регистрирует только provider и не создает RMock в домене.
   */
  public register(registration: EndgeMockRegistration): void {
    const ref = normalizeRef(registration?.identity)
    const data = cloneMockValue(registration?.data)
    this.registerProvider({
      ref,
      description: registration?.description,
      provide: () => data,
    })
  }

  /** Возвращает состояние binding persisted mock и code provider. */
  public getBindingStatus(identity: string): EndgeMockBindingStatus {
    const mock = Endge.domain.getMock(normalizeIdentity(identity))
    if (!mock)
      return 'missing-document'
    if (mock.contentSource === 'code-provider')
      return mock.codeRef && this._providers.has(mock.codeRef) ? 'connected' : 'missing-provider'
    if (mock.contentType === 'application/json') {
      try {
        JSON.parse(mock.source)
      }
      catch {
        return 'invalid-content'
      }
    }
    return 'document'
  }

  /** Проверяет, может ли persisted mock быть разрешен прямо сейчас. */
  public has(identity: string): boolean {
    const status = this.getBindingStatus(identity)
    return status === 'document' || status === 'connected'
  }

  /** Разрешает данные из persisted document или его code provider. */
  public get<T = unknown>(identity: string): T {
    const normalizedIdentity = normalizeIdentity(identity)
    const mock = Endge.domain.getMock(normalizedIdentity)
    if (!mock)
      throw new Error(`[EndgeMock] Persisted mock document "${normalizedIdentity}" is not loaded.`)

    if (mock.contentSource === 'code-provider') {
      const ref = normalizeRef(mock.codeRef)
      const provider = this._providers.get(ref)
      if (!provider)
        throw new Error(`[EndgeMock] Provider "${ref}" for mock "${normalizedIdentity}" is not registered.`)
      const value = provider.provide({ mock })
      if (value && typeof (value as { then?: unknown }).then === 'function')
        throw new Error(`[EndgeMock] Provider "${ref}" must be synchronous.`)
      return cloneMockValue(value) as T
    }

    if (mock.contentType === 'text/plain')
      return mock.source as T

    try {
      return cloneMockValue(JSON.parse(mock.source)) as T
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(`[EndgeMock] Mock "${normalizedIdentity}" contains invalid JSON: ${message}`)
    }
  }

  /** Возвращает descriptions зарегистрированных code providers. */
  public listProviders(): EndgeMockDescriptor[] {
    return [...this._providers.values()].map(item => ({
      ref: item.ref,
      ...(item.description ? { description: item.description } : {}),
    }))
  }

  /** @deprecated Используйте listProviders(). */
  public list(): EndgeMockDescriptor[] {
    return this.listProviders()
  }

  /** Очищает runtime providers. */
  public override reset(): void {
    this._providers.clear()
    this.notify()
  }

  /** Возвращает легкий snapshot provider registry. */
  public override serialize(): EndgeMockSnapshot {
    return { providers: this.listProviders() }
  }
}

function normalizeProvider(provider: EndgeMockProvider): EndgeMockProvider {
  if (typeof provider?.provide !== 'function')
    throw new Error('[EndgeMock] Provider.provide must be a function.')
  return {
    ref: normalizeRef(provider.ref),
    provide: provider.provide,
    ...(provider.description ? { description: String(provider.description).trim() } : {}),
  }
}

function normalizeIdentity(identity: unknown): string {
  const normalized = String(identity ?? '').trim()
  if (!normalized)
    throw new Error('[EndgeMock] Mock identity is required.')
  return normalized
}

function normalizeRef(ref: unknown): string {
  const normalized = String(ref ?? '').trim()
  if (!normalized)
    throw new Error('[EndgeMock] Provider ref is required.')
  return normalized
}

function cloneMockValue<T>(value: T): T {
  try {
    const json = JSON.stringify(value)
    if (json === undefined)
      throw new Error('not JSON-compatible')
    return JSON.parse(json) as T
  }
  catch {
    throw new Error('[EndgeMock] Mock data must be JSON-compatible.')
  }
}
