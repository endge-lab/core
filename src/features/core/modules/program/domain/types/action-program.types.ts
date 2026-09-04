import type { ActionTargetSelector } from '@/features/core/modules/runtime/domain/action.types'
import type { ActionSourceDocument } from '@/features/core/modules/source/domain/types/action-source.types'

export interface ActionProgramPayload {
  type: 'action'
  sourceVersion: number
  sourceDocument: ActionSourceDocument | null
  target: ActionTargetSelector[] | null
}
