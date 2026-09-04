import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'
import { EndgeFederation } from '@/features/federation/EndgeFederation'

/**
 * Единая статическая федерация Endge Core.
 * Lifecycle context и readonly accessors выводятся из деклараций её Modules.
 */
export const Endge = EndgeFederation.define({
  id: 'endge',
  name: 'Endge',
  modules: ENDGE_CORE_MODULES,
})
