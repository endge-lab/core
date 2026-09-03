import type { EndgeModule } from '@/kernel/EndgeModule'
import type { EndgeBootContext } from '@/kernel/types/bootstrap.types'
import type { EndgeModuleDescriptor, EndgePlugin } from '@/kernel/types/endge-modules.types'

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
