import type {
  EndgePersistenceDriver,
  EndgePersistenceOptions,
  EndgeStorageAdapter,
} from '@/domain/types/context-persistence.types'

export type EndgePersistenceInput
  = EndgePersistenceDriver
    | EndgePersistenceOptions
    | null
    | undefined

export function normalizePersistence(input: EndgePersistenceInput): EndgePersistenceOptions {
  if (typeof input === 'string') {
    return { driver: normalizePersistenceDriver(input) }
  }

  return {
    driver: normalizePersistenceDriver(input?.driver),
  }
}

export function normalizePersistenceDriver(value: unknown): EndgePersistenceDriver {
  return value === 'disabled' ? 'disabled' : 'local'
}

export class EndgeStorageAdapterRegistry {
  private readonly _adapters = new Map<EndgePersistenceDriver, EndgeStorageAdapter>()

  public register(adapter: EndgeStorageAdapter): void {
    this._adapters.set(adapter.id, adapter)
  }

  public resolve(input: EndgePersistenceInput): EndgeStorageAdapter {
    const persistence = normalizePersistence(input)
    const adapter = this._adapters.get(persistence.driver ?? 'local')
    if (adapter) {
      return adapter
    }

    const fallback = this._adapters.get('disabled')
    if (!fallback) {
      throw new Error('[EndgeContext] Disabled storage adapter is not registered.')
    }

    return fallback
  }
}
