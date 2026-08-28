import type { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type { EndgeModuleDescriptor, EndgePlugin } from '@/domain/types/kernel/endge-modules.types'

export type EndgeFederationState = 'idle' | 'booting' | 'ready' | 'building' | 'resetting' | 'failed'

export interface EndgeFederationHost {
  isConfigured: boolean
  isConfiguring: boolean
  isSetup: boolean
  isInitialized: boolean
  state: EndgeFederationState
  lastError: unknown | null
  bootContext: EndgeBootContext | null
  bootPromise: Promise<void> | null
  resetPromise: Promise<void> | null
  buildQueue: Promise<void>
  pendingBuilds: number
  moduleDescriptors: EndgeModuleDescriptor[]
  modules: Map<string, EndgeModule>
  plugins: EndgePlugin[]
  installedPluginIds: Set<string>
}
