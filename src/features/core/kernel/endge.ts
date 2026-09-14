import type { EndgeBootMode } from '@/features/core/kernel/types/bootstrap.types'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { EndgeLiveDomainSnapshot } from '@/features/core/modules/domain/types/document/domain-snapshot.type'
import { selectCoreLifecycleNodes } from '@/features/core/kernel/config/debugger.config'
import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'
import { EndgeDebuggerReadOnlyError } from '@/features/core/kernel/errors/EndgeDebuggerReadOnlyError'
import { readEndgeBundle } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
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
  public static get mode(): EndgeBootMode {
    return this.context.bootMode
  }

  /** Builds the saved authoring state without activating Runtime hosts. */
  public static async buildSavedProgram(signal?: AbortSignal): Promise<EndgeLiveDomainSnapshot | null> {
    this.assertWritable()
    signal?.throwIfAborted()
    const snapshot = await this.domainRepository.refreshSnapshot(signal)
    if (snapshot) {
      signal?.throwIfAborted()
      this.domain.reset()
      this.domain.mergeFromSnapshot(snapshot)
    }
    signal?.throwIfAborted()
    await this.build()
    signal?.throwIfAborted()
    return snapshot
  }

  /** Валидирует обе части до установки; файл только с чанками дополняет текущую историю. */
  public static installDebuggerBundle(input: unknown): void {
    if (this.mode !== 'debugger') {
      throw new Error('[Endge] Bundle inspection requires debugger mode')
    }
    const value = readEndgeBundle(input)
    if (!value.bundle) {
      if (!value.inspection) {
        throw new Error('[Endge] Empty bundle')
      }
      this.inspection.appendRecording(value.inspection)
      return
    }
    const program = this.program.prepareInstall(value.bundle)
    const recording = value.inspection
      ? this.inspection.prepare(value.inspection)
      : null
    const workspace = {
      identity: program.bundle.context.workspace ?? 'inspection',
      displayName: program.bundle.context.workspace ?? 'Inspection',
      startupCompositionIdentity: null,
      ...program.bundle.catalog.workspace,
      dataMode: 'live' as const,
      managedBy: 'user' as const,
      managedById: null,
      installedIntegrations: [],
      configuration: program.bundle.context.configuration,
    }
    this.domain.replaceFromPlain({})
    this.program.installBundle(program)
    this.workspace.applyInspection(workspace)
    this.configuration.applyInspection(program.bundle.context.configuration)
    this.context.applyInspection(program.bundle.context)
    this.runtime.clearInspection()
    this.inspection.clear()
    if (recording) {
      this.inspection.open(recording)
    }
  }

  /** Replaces an inspected application's document and contextual state without activating it. */
  public static replaceDebuggerSnapshot(snapshot: DiagnosticsSnapshot): void {
    if (this.mode !== 'debugger') {
      throw new Error('[Endge] Snapshot inspection requires debugger mode')
    }
    const prepared = prepareDebuggerSnapshot(snapshot)
    this.domain.replaceFromPlain(prepared.domain)
    this.workspace.applyInspection(prepared.workspace)
    this.configuration.applyInspection(prepared.configuration)
    this.context.applyInspection(prepared.context)
    if (prepared.runtime) {
      this.runtime.applyInspectionSnapshot(prepared.runtime)
    }
    else {
      this.runtime.clearInspection()
    }
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
