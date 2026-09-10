import type { EndgeBootMode } from '@/features/core/kernel/types/bootstrap.types'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import { selectCoreLifecycleNodes } from '@/features/core/kernel/config/debugger.config'
import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'
import { EndgeDebuggerReadOnlyError } from '@/features/core/kernel/errors/EndgeDebuggerReadOnlyError'
import { prepareDebuggerSnapshot } from '@/features/core/kernel/tools/debugger-snapshot'
import { EndgeFederation } from '@/features/federation/EndgeFederation'

/**
 * Единая статическая федерация Endge Core.
 * Lifecycle context и readonly accessors выводятся из деклараций её graph.
 */
class EndgeCore extends EndgeFederation.define({
  id: 'endge',
  name: 'Endge',
  modules: ENDGE_CORE_MODULES,
  selectLifecycleNodes: selectCoreLifecycleNodes,
}) {
  /** Active Core mode is owned by the boot context and is read-only. */
  public static get mode(): EndgeBootMode { return this.context.bootMode }

  /** Replaces an inspected application's document and contextual state without activating it. */
  public static replaceDebuggerSnapshot(snapshot: DiagnosticsSnapshot): void {
    if (this.mode !== 'debugger') {
      throw new Error('[Endge] Snapshot inspection requires debugger mode')
    }
    const prepared = prepareDebuggerSnapshot(snapshot)
    this.domain.replaceFromPlain(prepared.domain)
    this.workspace.applyInspection(prepared.workspace)
    this.context.applyInspection(prepared.context)
  }

  /** Shared guard before user mutations, including editor synchronization. */
  public static assertWritable(): void {
    if (this.mode === 'debugger') {
      throw new EndgeDebuggerReadOnlyError()
    }
  }
}

/** Типизированные accessors, которые внешние packages добавляют через module augmentation. */
export interface EndgeExtensions {}

/** Единый facade Core и всех зарегистрированных до boot расширений. */
export const Endge = EndgeCore as typeof EndgeCore & Readonly<EndgeExtensions>
