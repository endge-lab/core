import type { ActionTargetSelector } from '@/features/core/modules/actions/domain/action.types'
import type { ActionSourceDocument } from '@/features/core/modules/source/domain/types/action-source.types'

export interface ActionProgramPayload {
  // Optional parser tree retained for inspection; runtime does not require it.
  ast?: unknown
  type: 'action'
  sourceVersion: number
  sourceDocument: ActionSourceDocument | null
  target: ActionTargetSelector[] | null
}
