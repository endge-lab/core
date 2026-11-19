import type { EndgeBootContext, EndgeBootMode } from '@/features/core/kernel/types/bootstrap.types'
import type { DeliveryFacetSelection } from '@/features/core/kernel/types/endge-bundle.types'
import type { DiagnosticsSnapshot } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'
import type { EndgeLiveDomainSnapshot } from '@/features/core/modules/domain/types/document/domain-snapshot.type'
import { selectCoreLifecycleNodes } from '@/features/core/kernel/config/debugger.config'
import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'
import { EndgeDebuggerReadOnlyError } from '@/features/core/kernel/errors/EndgeDebuggerReadOnlyError'
import { readEndgeBundle } from '@/features/core/kernel/services/EndgeBundleCodec_Service'
import { selectDeliveryProgram, selectDeliveryRenderers } from '@/features/core/kernel/tools/bundle-delivery'
import { prepareDebuggerSnapshot } from '@/features/core/kernel/tools/debugger-snapshot'
import { materializeDeliveryDomain, projectDeliveryDocuments } from '@/features/core/kernel/tools/delivery-domain'
import { expandDeliveryFacets } from '@/features/core/kernel/tools/delivery-facets'
import { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'
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
  private static _deliveryProgram: EndgeProgram_Module | null = null

  public static override get program(): EndgeProgram_Module {
    return this._deliveryProgram ?? this.getModule<EndgeProgram_Module>('program')
  }

  public static async buildSavedDelivery(selection: DeliveryFacetSelection, signal?: AbortSignal) {
    const snapshot = await this.buildSavedProgram(signal)
    const contexts = expandDeliveryFacets(selection, this.configuration.availableFacets())
    const derivedActions = this.domain.resolved.list('action').filter(action => action.origin.kind === 'derived')
    const domain = this.domain.toPlain()
    const bundles = []
    try {
      for (const facets of contexts) {
        signal?.throwIfAborted()
        this._deliveryProgram = new EndgeProgram_Module()
        bundles.push(this.configuration.withBuildContext(facets, () => {
          this.compiler.build({ scope: { workspaceIdentity: this.workspace.current.identity }, vars: {} })
          const error = this.program.getDiagnostics().find(diagnostic => diagnostic.severity === 'error')
          if (error) {
            throw new Error(`[Bundle] ${JSON.stringify(facets)}: ${error.message}`)
          }
          const bundle = this.program.exportBundle({ scope: 'startup-composition' })
          return {
            ...bundle,
            context: {
              ...bundle.context,
              configuration: { ...bundle.context.configuration, defaultRenderers: selectDeliveryRenderers(bundle) },
              workspace: this.workspace.current.identity,
              user: null,
              locale: bundle.context.configuration.defaultLocale,
              theme: bundle.context.configuration.defaultTheme,
              timezone: bundle.context.configuration.defaultTimezone,
            },
            runtimeDocuments: projectDeliveryDocuments(bundle, domain),
          }
        }))
      }
    }
    finally {
      this._deliveryProgram = null
      this.domain.resolved.clearDerived('action')
      for (const action of derivedActions) {
        this.domain.resolved.set('action', action)
      }
    }
    return { snapshot, bundles }
  }

  public static async bootDelivery(input: unknown, facets: Readonly<Record<string, string>>, host: EndgeBootContext): Promise<void> {
    const container = readEndgeBundle(input)
    if (!container.bundle || !container.delivery) {
      throw new Error('[Bundle] A delivery bundle is required')
    }
    const program = selectDeliveryProgram(container.bundle, container.delivery, facets)
    const workspaceIdentity = program.catalog.workspace!.identity
    if (host.scope.workspaceIdentity && host.scope.workspaceIdentity !== workspaceIdentity) {
      throw new Error('[Bundle] Delivery belongs to another workspace')
    }
    await this.boot({
      ...host,
      mode: 'application',
      dataProvider: 'plain',
      scope: { workspaceIdentity },
      context: { facets },
      deliveryProgram: program,
      plainSource: materializeDeliveryDomain(program),
    } satisfies EndgeBootContext)
  }

  /**
   * Active Core mode is owned by the boot context and is read-only.
   */
  public static get mode(): EndgeBootMode {
    return this.context.bootMode
  }

  /**
   * Builds the saved authoring state without activating Runtime hosts.
   */
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

  /**
   * Валидирует обе части до установки; файл только с чанками дополняет текущую историю.
   */
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

  /**
   * Replaces an inspected application's document and contextual state without activating it.
   */
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

  /**
   * Shared guard before user mutations, including editor synchronization.
   */
  public static assertWritable(): void {
    if (this.mode === 'debugger') {
      throw new EndgeDebuggerReadOnlyError()
    }
  }
}

// Типизированные accessors, которые внешние packages добавляют через module augmentation.
export interface EndgeExtensions {}

// Единый facade Core и всех зарегистрированных до boot расширений.
export const Endge = EndgeCore as typeof EndgeCore & Readonly<EndgeExtensions>
