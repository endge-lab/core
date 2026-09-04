import type { EndgePublicConfigurationSnapshot } from '@/features/core/modules/configuration/domain/types/configuration.type'

export type EndgePersistenceDriver = 'local' | 'disabled'

export interface EndgePersistenceOptions {
  driver?: EndgePersistenceDriver
}

export interface EndgeContextPersistenceConfig {
  context?: EndgePersistenceDriver | EndgePersistenceOptions | null
}

export interface EndgeContextSnapshot {
  workspace: string | null
  tenant: string | null
  project: string | null
  environment: string | null
  user: string | null
  locale: string | null
  theme: string | null
  timezone: string | null
}

/** Данные хранилища, отличающие явный выбор темы от фактического default. */
export interface EndgePersistedContextSnapshot extends EndgeContextSnapshot {
  themePreferenceVersion?: 1
}

/** Временное состояние клавиатуры, предоставляемое активным UI-адаптером. */
export interface EndgeKeyboardContextSnapshot {
  platform: 'macos' | 'windows' | 'linux' | 'unknown'
  modifiers: {
    ctrl: boolean
    shift: boolean
    alt: boolean
    meta: boolean
    mod: boolean
    altGraph: boolean
  }
  held: {
    key: string[]
    code: string[]
  }
}

/** Полный readonly-контекст SFC. Временное состояние ввода намеренно не сериализуется. */
export interface EndgeRuntimeContextSnapshot extends EndgeContextSnapshot {
  /** Статическая фактическая конфигурация текущей сборки; не сохраняется и не поддерживается Raph. */
  config: EndgePublicConfigurationSnapshot
  input: {
    keyboard: EndgeKeyboardContextSnapshot
  }
}

export interface EndgePersistenceScope {
  workspaceId: string
  tenantId: string
  projectId: string
  environmentId: string
  userId: string
}

export type EndgePersistenceScopeResolver = () => EndgePersistenceScope

export interface EndgeSessionIdentity {
  userId?: string | null
  tenantId?: string | null
}

export interface EndgeSessionIdentityProvider {
  getCurrentIdentity: () => EndgeSessionIdentity | null
}

export interface EndgeStorageAdapter {
  readonly id: EndgePersistenceDriver

  isAvailable: () => boolean

  read: <T>(key: string) => T | undefined

  write: <T>(key: string, value: T) => void

  remove: (key: string) => void
}

export interface RuntimeStateDocument {
  version: 1
  scope: EndgePersistenceScope
  runtimeId: string
  state: Record<string, Record<string, unknown>>
}

export interface RuntimeStateControllerLike {
  readonly runtimeId: string
  readonly storageId: string
  readonly storageKey: string
  readonly scope: EndgePersistenceScope

  get: <T>(entityKey: string, section: string, fallback: T) => T

  set: <T>(entityKey: string, section: string, value: T) => void

  remove: (entityKey: string, section?: string) => void

  clear: () => void
}
