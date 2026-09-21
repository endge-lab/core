import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type {
  ComponentSFCInteractionTriggerEvent,
  ComponentSFCInteractionTriggerPlatform,
} from '@/features/core/modules/domain/types/component/sfc/ir.types'

/** Keyboard event, приведённое platform adapter к общему TriggerSet contract. */
export interface DiagnosticsSnapshotShortcutEvent {
  type: 'keydown' | 'keyup'
  occurrence: ComponentSFCInteractionTriggerEvent
  platform: ComponentSFCInteractionTriggerPlatform
  preventDefault: () => void
  stopPropagation: () => void
}

/** Platform boundary подписки на shortcut и сохранения snapshot-файла. */
export interface DiagnosticsSnapshotRuntimeAdapter {
  subscribeShortcut: (listener: (event: DiagnosticsSnapshotShortcutEvent) => void) => () => void
  downloadJson: (snapshot: DiagnosticsSnapshot) => void
}
