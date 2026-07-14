import type {
  EndgeMockDescriptor,
  EndgeMockRegistration,
  EndgeMockSnapshot,
} from '@/domain/types/mock'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { ENDGE_BUILTIN_MOCKS } from '@/model/config/endge-mocks'

/** Registry и runtime reader mock payload по стабильному identity. */
export class EndgeMock extends EndgeModule {
  private readonly _items = new Map<string, EndgeMockRegistration>()

  /** Создает registry и регистрирует встроенные mock payload. */
  public constructor() {
    super()
    this.reset()
  }

  /** Регистрирует mock payload и запрещает неявную замену существующего identity. */
  public register(registration: EndgeMockRegistration): void {
    const normalized = normalizeRegistration(registration)
    if (this._items.has(normalized.identity))
      throw new Error(`[EndgeMock] Mock "${normalized.identity}" is already registered.`)

    this._items.set(normalized.identity, normalized)
    this.notify()
  }

  /** Проверяет наличие mock payload по identity. */
  public has(identity: string): boolean {
    return this._items.has(normalizeIdentity(identity))
  }

  /** Возвращает независимую копию mock payload или бросает явную ошибку. */
  public get<T = unknown>(identity: string): T {
    const normalizedIdentity = normalizeIdentity(identity)
    const registration = this._items.get(normalizedIdentity)
    if (!registration)
      throw new Error(`[EndgeMock] Mock "${normalizedIdentity}" is not registered.`)

    return cloneMockValue(registration.data) as T
  }

  /** Возвращает описания зарегистрированных mock payload без тяжелых данных. */
  public list(): EndgeMockDescriptor[] {
    return [...this._items.values()].map(item => ({
      identity: item.identity,
      ...(item.description ? { description: item.description } : {}),
    }))
  }

  /** Очищает runtime registration и восстанавливает встроенный manifest. */
  public override reset(): void {
    this._items.clear()
    for (const registration of ENDGE_BUILTIN_MOCKS)
      this._items.set(registration.identity, normalizeRegistration(registration))
    this.notify()
  }

  /** Возвращает легкий snapshot registry для diagnostics и configurator UI. */
  public override serialize(): EndgeMockSnapshot {
    return { mocks: this.list() }
  }
}

function normalizeRegistration(registration: EndgeMockRegistration): EndgeMockRegistration {
  return {
    identity: normalizeIdentity(registration?.identity),
    data: cloneMockValue(registration?.data),
    ...(registration?.description
      ? { description: String(registration.description).trim() }
      : {}),
  }
}

function normalizeIdentity(identity: unknown): string {
  const normalized = String(identity ?? '').trim()
  if (!normalized)
    throw new Error('[EndgeMock] Mock identity is required.')
  return normalized
}

function cloneMockValue<T>(value: T): T {
  try {
    const json = JSON.stringify(value)
    if (json === undefined)
      throw new Error('[EndgeMock] Mock data must be JSON-compatible.')
    return JSON.parse(json) as T
  }
  catch {
    throw new Error('[EndgeMock] Mock data must be JSON-compatible.')
  }
}
