import type { ActionTargetSelector } from '@/domain/types/runtime/action.types'
import type { ActionSourceDocument } from '@/domain/types/source/action-source.types'

export interface ActionProgramPayload {
  type: 'action'
  sourceVersion: number
  sourceDocument: ActionSourceDocument | null
  target: ActionTargetSelector[] | null
}
