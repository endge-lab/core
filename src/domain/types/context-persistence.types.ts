export type EndgePersistenceDriver = 'local' | 'disabled'

export interface EndgePersistenceOptions {
  driver?: EndgePersistenceDriver
}

export interface EndgePersistenceScope {
  workspaceId: string
  tenantId: string
  projectId: string
  environmentId: string
  userId: string
}

export interface EndgeSessionIdentity {
  userId?: string | null
  tenantId?: string | null
}

export interface EndgeSessionIdentityProvider {
  getCurrentIdentity(): EndgeSessionIdentity | null
}

export interface EndgeStorageAdapter {
  readonly id: EndgePersistenceDriver

  isAvailable(): boolean

  read<T>(key: string): T | undefined

  write<T>(key: string, value: T): void

  remove(key: string): void
}

export interface RuntimeStateDocument {
  version: 1
  scope: EndgePersistenceScope
  runtimeId: string
  state: Record<string, Record<string, unknown>>
}

export interface RuntimeStateControllerLike {
  readonly runtimeId: string
  readonly storageKey: string
  readonly scope: EndgePersistenceScope

  get<T>(entityKey: string, section: string, fallback: T): T

  set<T>(entityKey: string, section: string, value: T): void

  remove(entityKey: string, section?: string): void

  clear(): void
}
