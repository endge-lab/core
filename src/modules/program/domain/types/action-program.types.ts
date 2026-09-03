import type { ActionTargetSelector } from '@/modules/runtime/domain/action.types'
import type { ActionSourceDocument } from '@/modules/source/domain/types/action-source.types'

export interface ActionProgramPayload {
  type: 'action'
  sourceVersion: number
  sourceDocument: ActionSourceDocument | null
  target: ActionTargetSelector[] | null
}
