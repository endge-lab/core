import type { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type { EndgeModuleDescriptor, EndgePlugin } from '@/domain/types/endge-modules.types'

export interface EndgeFederationHost {
  isConfigured: boolean
  isConfiguring: boolean
  isSetup: boolean
  isInitialized: boolean
  isHydrating: boolean
  moduleDescriptors: EndgeModuleDescriptor[]
  modules: Map<string, EndgeModule>
  plugins: EndgePlugin[]
  installedPluginIds: Set<string>
}
