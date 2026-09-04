import type { EndgeModule } from '@/features/federation/EndgeModule'
import type {
  EndgeModuleDefinitions,
  EndgeModuleDescriptor,
  EndgePlugin,
} from '@/features/federation/types/endge-modules.types'

/** Минимальный context, общий для lifecycle любой федерации. */
export interface EndgeFederationContext {
  signal?: AbortSignal
}

export type EndgeFederationState = 'idle' | 'booting' | 'ready' | 'building' | 'resetting' | 'failed'

/** Полное декларативное описание автоматически собираемой федерации. */
export interface EndgeFederationDefinition<TDefinitions extends EndgeModuleDefinitions> {
  readonly id: string
  readonly name?: string
  readonly modules: TDefinitions
}

export interface EndgeFederationHost {
  isConfigured: boolean
  isConfiguring: boolean
  isSetup: boolean
  isInitialized: boolean
  state: EndgeFederationState
  lastError: unknown | null
  bootContext: EndgeFederationContext | null
  bootPromise: Promise<void> | null
  resetPromise: Promise<void> | null
  buildQueue: Promise<void>
  pendingBuilds: number
  moduleDescriptors: EndgeModuleDescriptor[]
  modules: Map<string, EndgeModule>
  plugins: EndgePlugin[]
  installedPluginIds: Set<string>
}
