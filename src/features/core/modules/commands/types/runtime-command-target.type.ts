import type { RuntimeControlOperation, RuntimeControlTarget } from '@/features/core/modules/runtime/domain/runtime-inspection.types'

/** Узкий API владельца Runtime для общих локальных обработчиков. */
export interface EndgeRuntimeCommandTarget {
  control: (operation: RuntimeControlOperation, target: RuntimeControlTarget) => Promise<void>
}
