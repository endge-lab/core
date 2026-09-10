import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { EndgePublishedEvent } from '@/features/core/modules/events/domain/events.types'
import type { RuntimeInspectionSnapshot } from '@/features/core/modules/runtime/domain/runtime-inspection.types'

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

/** Объёмные снимки используют тот же sequenced session stream, но отдельный transport limit. */
export interface BridgeInspectionUpdate {
  readonly sequence: number
  readonly update:
    | { kind: 'runtime', snapshot: RuntimeInspectionSnapshot }
    | { kind: 'data', data: unknown, render?: RuntimeInspectionSnapshot['render'], generatedAt: number }
    | { kind: 'data-error', message: string }
}
export type BridgeInspectionMessage = BridgeStreamEvent | BridgeInspectionUpdate
