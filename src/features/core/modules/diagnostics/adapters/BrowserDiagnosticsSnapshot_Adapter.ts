import type { DiagnosticsSnapshotRuntimeAdapter, DiagnosticsSnapshotShortcutEvent } from '@/features/core/modules/diagnostics/domain/types/diagnostics-snapshot-runtime-adapter.type'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { getKeyboardStateSnapshot } from '@endge/utils'
import { resolveComponentSFCInteractionTriggerPlatform } from '@/features/core/modules/domain/component/component-sfc-edit-trigger'

/** Browser implementation platform boundary диагностических snapshots. */
export class BrowserDiagnosticsSnapshot_Adapter implements DiagnosticsSnapshotRuntimeAdapter {
  /** Подписывает Core на глобальные keyboard events текущего document. */
  public subscribeShortcut(listener: (event: DiagnosticsSnapshotShortcutEvent) => void): () => void {
    if (typeof document === 'undefined') {
      return () => {}
    }

    getKeyboardStateSnapshot(document)
    const handle = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest('[data-endge-trigger-recording="true"]')) {
        return
      }
      const keyboard = getKeyboardStateSnapshot(document)
      listener({
        type: event.type === 'keyup' ? 'keyup' : 'keydown',
        occurrence: {
          key: event.key,
          code: event.code,
          repeat: event.repeat,
          composing: event.isComposing,
          targetIsCurrentTarget: event.target === event.currentTarget,
          held: {
            key: keyboard.held.key.filter(key => key.toLowerCase() !== event.key.toLowerCase()),
            code: keyboard.held.code.filter(code => code !== event.code),
          },
          modifiers: {
            ctrl: event.ctrlKey,
            shift: event.shiftKey,
            alt: event.altKey,
            meta: event.metaKey,
            altGraph: event.getModifierState?.('AltGraph') === true,
          },
        },
        platform: resolveComponentSFCInteractionTriggerPlatform(keyboard.platform),
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
      })
    }

    document.addEventListener('keydown', handle, true)
    document.addEventListener('keyup', handle, true)
    return () => {
      document.removeEventListener('keydown', handle, true)
      document.removeEventListener('keyup', handle, true)
    }
  }

  /** Сохраняет JSON-safe snapshot в файл средствами browser platform. */
  public downloadJson(snapshot: DiagnosticsSnapshot): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      throw new Error('[EndgeDiagnostics] Browser snapshot download is unavailable')
    }
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = `endge-diagnostics-${snapshot.generatedAt}.json`
    link.hidden = true
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
  }
}
