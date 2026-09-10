import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { EndgePublishedEvent } from '@/features/core/modules/events/domain/events.types'

/** Начальное состояние и граница последующих событий одного согласованного сеанса. */
export interface BridgeInspectionSnapshot {
  readonly snapshot: DiagnosticsSnapshot
  readonly sequence: number
}

/** Последовательность относится к потоку сеанса; метаданные самой публикации сохраняются в event. */
export interface BridgeStreamEvent {
  readonly sequence: number
  readonly event: EndgePublishedEvent
}
