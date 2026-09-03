import type { EndgeBootContext } from '@/kernel/types/bootstrap.types'
import type { EndgeAuth_Module } from '@/modules/auth/EndgeAuth_Module'
import type { EndgeCompiler_Module } from '@/modules/compiler/EndgeCompiler_Module'
import type { EndgeConfiguration_Module } from '@/modules/configuration/EndgeConfiguration_Module'
import type { EndgeConfigurationSchema_Module } from '@/modules/configuration/EndgeConfigurationSchema_Module'
import type { WorkspaceVariables } from '@/modules/context/endge-vars'
import type { EndgeContext_Module } from '@/modules/context/EndgeContext_Module'
import type { EndgeDiagnostics_Module } from '@/modules/diagnostics/EndgeDiagnostics_Module'
import type { EndgeDocumentImport_Module } from '@/modules/document-import/EndgeDocumentImport_Module'
import type { EndgeDomainRepository_Module } from '@/modules/domain-repository/EndgeDomainRepository_Module'
import type { EndgeDomain_Module } from '@/modules/domain/EndgeDomain_Module'
import type { EndgeRuntimeDebugger_Module } from '@/modules/EndgeRuntimeDebugger_Module'
import type { EndgeTypes_Module } from '@/modules/EndgeTypes_Module'
import type { EndgeVocabs_Module } from '@/modules/EndgeVocabs_Module'
import type { EndgeEvents_Module } from '@/modules/events/EndgeEvents_Module'
import type { EndgeI18n_Module } from '@/modules/i18n/EndgeI18n_Module'
import type { EndgeMock_Module } from '@/modules/mock/EndgeMock_Module'
import type { EndgeProgram_Module } from '@/modules/program/EndgeProgram_Module'
import type { EndgeActions } from '@/modules/runtime/endge-actions'
import type { EndgeRuntime_Module } from '@/modules/runtime/EndgeRuntime_Module'
import type { EndgeComposition } from '@/modules/runtime/execution/endge-composition'
import type { EndgeComputation } from '@/modules/runtime/execution/endge-computation'
import type { EndgeConverters } from '@/modules/runtime/execution/endge-converters'
import type { EndgeDataView } from '@/modules/runtime/execution/endge-data-view'
import type { EndgeQuery } from '@/modules/runtime/execution/endge-query'
import type { EndgeSource_Module } from '@/modules/source/EndgeSource_Module'
import type { EndgeStyles_Module } from '@/modules/styles/EndgeStyles_Module'
import type { EndgeUI_Module } from '@/modules/ui/EndgeUI_Module'
import type { EndgeUIRegistry_Module } from '@/modules/ui/EndgeUIRegistry_Module'
import type { EndgeUpdates_Module } from '@/modules/updates/EndgeUpdates_Module'
import type { EndgeWorkspace_Module } from '@/modules/workspace/EndgeWorkspace_Module'
import { ENDGE_CORE_MODULES } from '@/kernel/config/modules.config'
import { EndgeFederation } from '@/kernel/EndgeFederation'
import { setEndgeFederationStorageAdapter } from '@/kernel/EndgeFederationStorage'
import { LocalStorageContextAdapter } from '@/modules/context/persistence/adapters/LocalStorageContextAdapter'
import { DomainSnapshotCodec } from '@/modules/domain-repository/services/DomainSnapshotCodec'

setEndgeFederationStorageAdapter(new LocalStorageContextAdapter())

/**
 * Единая статическая федерация Endge.
 * Хост живёт в `globalThis`, поэтому `Endge` не дублируется даже если пакет подтянут из разных зависимостей.
 */
export class Endge extends EndgeFederation {
  protected static override readonly federationId = 'endge'
  private static _domainSnapshot: DomainSnapshotCodec | null = null

  /**
   * Запрещает создание экземпляров `Endge`.
   * Федерация используется только через статический public API.
   */
  private constructor() {
    super()
  }

  /**
   * Описывает системные модули ядра и создает их экземпляры.
   * Порядок берется из `ENDGE_CORE_MODULES` и может быть уточнен через `before/after`.
   */
  protected static override configureFederation(): void {
    for (const item of ENDGE_CORE_MODULES) {
      const Module = item.module
      this.defineModule({
        key: item.key,
        module: new Module(),
        before: item.before,
        after: item.after,
      })
    }
  }

  /**
   * Запускает ядро по полному boot pipeline: `setup -> load -> build -> start`.
   * Метод является единственной централизованной точкой старта `Endge`.
   */
  static override boot(ctx: EndgeBootContext): Promise<void> {
    return super.boot(ctx)
  }

  /**
   * Доступ к централизованному модулю logs, spans и adapters.
   */
  static get diagnostics(): EndgeDiagnostics_Module {
    return this.getModule<EndgeDiagnostics_Module>('diagnostics')
  }

  /**
   * Доступ к persisted domain model.
   */
  static get domain(): EndgeDomain_Module {
    return this.getModule<EndgeDomain_Module>('domain')
  }

  /** Доступ к подготовке и применению внешних схем как Domain-документов. */
  static get documentImport(): EndgeDocumentImport_Module {
    return this.getModule<EndgeDocumentImport_Module>('documentImport')
  }

  /** Доступ к чистому codec локального Domain snapshot. */
  public static get domainSnapshot(): DomainSnapshotCodec {
    this._domainSnapshot ??= new DomainSnapshotCodec(snapshot => this.domain.materializeSnapshot(snapshot))
    return this._domainSnapshot
  }

  /** Доступ к effective registry встроенных и пользовательских типов. */
  static get types(): EndgeTypes_Module {
    return this.getModule<EndgeTypes_Module>('types')
  }

  /**
   * Доступ к compiled program read-model.
   */
  static get program(): EndgeProgram_Module {
    return this.getModule<EndgeProgram_Module>('program')
  }

  /**
   * Доступ к компилятору домена в program artifacts.
   */
  static get compiler(): EndgeCompiler_Module {
    return this.getModule<EndgeCompiler_Module>('compiler')
  }

  /**
   * Доступ к authoring-модулю source-документов.
   */
  static get source(): EndgeSource_Module {
    return this.getModule<EndgeSource_Module>('source')
  }

  /**
   * Доступ к registry mock payload.
   */
  static get mock(): EndgeMock_Module {
    return this.getModule<EndgeMock_Module>('mock')
  }

  /**
   * Доступ к модулю словарей.
   */
  static get vocabs(): EndgeVocabs_Module {
    return this.getModule<EndgeVocabs_Module>('vocabs')
  }

  /**
   * Доступ к модулю переводов из доменных i18n-bundles.
   */
  static get i18n(): EndgeI18n_Module {
    return this.getModule<EndgeI18n_Module>('i18n')
  }

  /**
   * Доступ к runtime host manager.
   */
  static get runtime(): EndgeRuntime_Module {
    return this.getModule<EndgeRuntime_Module>('runtime')
  }

  /**
   * @deprecated Используйте Endge.workspace.variables.
   */
  static get vars(): WorkspaceVariables {
    return this.workspace.variables
  }

  /**
   * @deprecated Используйте Endge.runtime.query.
   */
  static get query(): EndgeQuery {
    return this.runtime.query
  }

  /**
   * @deprecated Используйте Endge.runtime.dataView.
   */
  static get dataView(): EndgeDataView {
    return this.runtime.dataView
  }

  /** @deprecated Используйте Endge.runtime.composition. */
  static get composition(): EndgeComposition {
    return this.runtime.composition
  }

  /**
   * Доступ к auth-модулю.
   */
  static get auth(): EndgeAuth_Module {
    return this.getModule<EndgeAuth_Module>('auth')
  }

  /**
   * Доступ к repository persisted domain.
   */
  static get domainRepository(): EndgeDomainRepository_Module {
    return this.getModule<EndgeDomainRepository_Module>('domainRepository')
  }

  /**
   * Доступ к модулю приема updates.
   */
  static get updates(): EndgeUpdates_Module {
    return this.getModule<EndgeUpdates_Module>('updates')
  }

  /**
   * Доступ к event bus модулю.
   */
  static get events(): EndgeEvents_Module {
    return this.getModule<EndgeEvents_Module>('events')
  }

  /**
   * Доступ к UI state модулю.
   */
  static get ui(): EndgeUI_Module {
    return this.getModule<EndgeUI_Module>('ui')
  }

  /**
   * Доступ к UI registry компонентов, renderers и presets.
   */
  static get uiRegistry(): EndgeUIRegistry_Module {
    return this.getModule<EndgeUIRegistry_Module>('uiRegistry')
  }

  /** Доступ к единому registry вызываемых runtime Actions. */
  static get actions(): EndgeActions {
    return this.runtime.actions
  }

  static get computations(): EndgeComputation {
    return this.runtime.computation
  }

  static get converters(): EndgeConverters {
    return this.runtime.converters
  }

  /**
   * Доступ к runtime debugger.
   */
  static get runtimeDebugger(): EndgeRuntimeDebugger_Module {
    return this.getModule<EndgeRuntimeDebugger_Module>('runtimeDebugger')
  }

  /**
   * Доступ к модулю компиляции и применения стилей.
   */
  static get styles(): EndgeStyles_Module {
    return this.getModule<EndgeStyles_Module>('styles')
  }

  /**
   * Доступ к прикладному контексту ядра: проект, окружение, локаль.
   */
  static get context(): EndgeContext_Module {
    return this.getModule<EndgeContext_Module>('context')
  }

  /** Доступ к effective configuration и immutable compiler build context. */
  static get configuration(): EndgeConfiguration_Module {
    return this.getModule<EndgeConfiguration_Module>('configuration')
  }

  static get configurationSchema(): EndgeConfigurationSchema_Module {
    return this.getModule<EndgeConfigurationSchema_Module>('configurationSchema')
  }

  /**
   * Доступ к frontend workspace profile: локали и будущие runtime capabilities.
   */
  static get workspace(): EndgeWorkspace_Module {
    return this.getModule<EndgeWorkspace_Module>('workspace')
  }
}
