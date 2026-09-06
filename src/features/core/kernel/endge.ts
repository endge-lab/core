import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'
import { EndgeFederation } from '@/features/federation/EndgeFederation'

/**
 * Единая статическая федерация Endge Core.
 * Lifecycle context и readonly accessors выводятся из деклараций её graph.
 */
const EndgeCore = EndgeFederation.define({
  id: 'endge',
  name: 'Endge',
  modules: ENDGE_CORE_MODULES,
})

/** Типизированные accessors, которые внешние packages добавляют через module augmentation. */
export interface EndgeExtensions {}

/** Единый facade Core и всех зарегистрированных до boot расширений. */
export const Endge = EndgeCore as typeof EndgeCore & Readonly<EndgeExtensions>
