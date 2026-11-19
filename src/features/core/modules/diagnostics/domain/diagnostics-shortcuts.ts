import type { DiagnosticsShortcutOperation, EndgeDiagnosticsShortcutSnapshotConfiguration } from './types/diagnostics.types'
import { BUILTIN_ACTION_IDS } from '@/features/core/modules/actions/domain/action.types'

export const DIAGNOSTICS_SHORTCUT_OPERATIONS = ['download', 'start', 'stop'] as const

export function legacyDiagnosticsShortcutOperation(
  shortcut: EndgeDiagnosticsShortcutSnapshotConfiguration,
): DiagnosticsShortcutOperation | null {
  switch (shortcut.action?.identity) {
    case undefined:
    case BUILTIN_ACTION_IDS.diagnosticsDownload:
      return 'download'
    case BUILTIN_ACTION_IDS.diagnosticsStartRecording:
      return 'start'
    case BUILTIN_ACTION_IDS.diagnosticsStopRecording:
      return 'stop'
    default:
      return null
  }
}
