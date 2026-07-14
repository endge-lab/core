import type { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type { EndgeModuleDescriptor, EndgePlugin } from '@/domain/types/kernel/endge-modules.types'
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'

export interface EndgeFederationHost {
  isConfigured: boolean
  isConfiguring: boolean
  isSetup: boolean
  isInitialized: boolean
  isHydrating: boolean
  bootContext: EndgeBootContext | null
  moduleDescriptors: EndgeModuleDescriptor[]
  modules: Map<string, EndgeModule>
  plugins: EndgePlugin[]
  installedPluginIds: Set<string>
}
