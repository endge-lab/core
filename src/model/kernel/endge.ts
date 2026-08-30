import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type { EndgeConfigurationModule } from '@/model/modules/context/endge-configuration'
import type { EndgeConfigurationSchemaModule } from '@/model/modules/context/endge-configuration-schema'
import type { EndgeContext } from '@/model/modules/context/endge-context'
import type { EndgeI18n } from '@/model/modules/context/endge-i18n'
import type { WorkspaceVariables } from '@/model/modules/context/endge-vars'
import type { EndgeWorkspace } from '@/model/modules/context/endge-workspace'
import type { EndgeDiagnostics } from '@/model/modules/diagnostics/endge-diagnostics'
import type { EndgeRuntimeDebugger } from '@/model/modules/diagnostics/endge-runtime-debugger'
import type { EndgeDomain } from '@/model/modules/domain/endge-domain'
import type { EndgeDomainRepository } from '@/model/modules/domain/endge-domain-repository'
import type { EndgeTypes } from '@/model/modules/domain/endge-types'
import type { EndgeVocabs } from '@/model/modules/domain/endge-vocabs'
import type { EndgeEvents } from '@/model/modules/events/endge-events'
import type { EndgeMock } from '@/model/modules/mock/EndgeMock'
import type { EndgeCompiler } from '@/model/modules/program/endge-compiler'
import type { EndgeProgram } from '@/model/modules/program/endge-program'
import type { EndgeSource } from '@/model/modules/program/endge-source'
import type { EndgeActions } from '@/model/modules/runtime/core/endge-actions'
import type { EndgeRuntime } from '@/model/modules/runtime/core/endge-runtime'
import type { EndgeUpdates } from '@/model/modules/runtime/core/endge-updates'
import type { EndgeComposition } from '@/model/modules/runtime/execution/endge-composition'
import type { EndgeComputation } from '@/model/modules/runtime/execution/endge-computation'
import type { EndgeConverters } from '@/model/modules/runtime/execution/endge-converters'
import type { EndgeDataView } from '@/model/modules/runtime/execution/endge-data-view'
import type { EndgeQuery } from '@/model/modules/runtime/execution/endge-query'
import type { EndgeAuth } from '@/model/modules/security/endge-auth'
import type { EndgeStyles } from '@/model/modules/ui/endge-styles'
import type { EndgeUI } from '@/model/modules/ui/endge-ui'
import type { EndgeUIRegistry } from '@/model/modules/ui/endge-ui-registry'
import { EndgeFederation } from '@/domain/entities/endge/EndgeFederation'
import { setEndgeFederationStorageAdapter } from '@/domain/entities/endge/EndgeFederationStorage'
import { ENDGE_CORE_MODULES } from '@/model/config/modules.config'
import { LocalStorageContextAdapter } from '@/model/modules/context/persistence/adapters/LocalStorageContextAdapter'
import { DomainSnapshotCodec } from '@/model/services/document/DomainSnapshotCodec'

setEndgeFederationStorageAdapter(new LocalStorageContextAdapter())

/**
 * Единая статическая федерация Endge.
 * Хост живёт в `globalThis`, поэтому `Endge` не дублируется даже если пакет подтянут из разных зависимостей.
 */
export class Endge extends EndgeFederation {
  protected static override readonly federationId = 'endge'
  private static readonly _domainSnapshot = new DomainSnapshotCodec()

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
  static get diagnostics(): EndgeDiagnostics {
    return this.getModule<EndgeDiagnostics>('diagnostics')
  }

  /**
   * Доступ к persisted domain model.
   */
  static get domain(): EndgeDomain {
    return this.getModule<EndgeDomain>('domain')
  }

  /** Доступ к чистому codec локального Domain snapshot. */
  public static get domainSnapshot(): DomainSnapshotCodec {
    return this._domainSnapshot
  }

  /** Доступ к effective registry встроенных и пользовательских типов. */
  static get types(): EndgeTypes {
    return this.getModule<EndgeTypes>('types')
  }

  /**
   * Доступ к compiled program read-model.
   */
  static get program(): EndgeProgram {
    return this.getModule<EndgeProgram>('program')
  }

  /**
   * Доступ к компилятору домена в program artifacts.
   */
  static get compiler(): EndgeCompiler {
    return this.getModule<EndgeCompiler>('compiler')
  }

  /**
   * Доступ к authoring-модулю source-документов.
   */
  static get source(): EndgeSource {
    return this.getModule<EndgeSource>('source')
  }

  /**
   * Доступ к registry mock payload.
   */
  static get mock(): EndgeMock {
    return this.getModule<EndgeMock>('mock')
  }

  /**
   * Доступ к модулю словарей.
   */
  static get vocabs(): EndgeVocabs {
    return this.getModule<EndgeVocabs>('vocabs')
  }

  /**
   * Доступ к модулю переводов из доменных i18n-bundles.
   */
  static get i18n(): EndgeI18n {
    return this.getModule<EndgeI18n>('i18n')
  }

  /**
   * Доступ к runtime host manager.
   */
  static get runtime(): EndgeRuntime {
    return this.getModule<EndgeRuntime>('runtime')
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
  static get auth(): EndgeAuth {
    return this.getModule<EndgeAuth>('auth')
  }

  /**
   * Доступ к repository persisted domain.
   */
  static get domainRepository(): EndgeDomainRepository {
    return this.getModule<EndgeDomainRepository>('domainRepository')
  }

  /**
   * Доступ к модулю приема updates.
   */
  static get updates(): EndgeUpdates {
    return this.getModule<EndgeUpdates>('updates')
  }

  /**
   * Доступ к event bus модулю.
   */
  static get events(): EndgeEvents {
    return this.getModule<EndgeEvents>('events')
  }

  /**
   * Доступ к UI state модулю.
   */
  static get ui(): EndgeUI {
    return this.getModule<EndgeUI>('ui')
  }

  /**
   * Доступ к UI registry компонентов, renderers и presets.
   */
  static get uiRegistry(): EndgeUIRegistry {
    return this.getModule<EndgeUIRegistry>('uiRegistry')
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
  static get runtimeDebugger(): EndgeRuntimeDebugger {
    return this.getModule<EndgeRuntimeDebugger>('runtimeDebugger')
  }

  /**
   * Доступ к модулю компиляции и применения стилей.
   */
  static get styles(): EndgeStyles {
    return this.getModule<EndgeStyles>('styles')
  }

  /**
   * Доступ к прикладному контексту ядра: проект, окружение, локаль.
   */
  static get context(): EndgeContext {
    return this.getModule<EndgeContext>('context')
  }

  /** Доступ к effective configuration и immutable compiler build context. */
  static get configuration(): EndgeConfigurationModule {
    return this.getModule<EndgeConfigurationModule>('configuration')
  }

  static get configurationSchema(): EndgeConfigurationSchemaModule {
    return this.getModule<EndgeConfigurationSchemaModule>('configurationSchema')
  }

  /**
   * Доступ к frontend workspace profile: локали и будущие runtime capabilities.
   */
  static get workspace(): EndgeWorkspace {
    return this.getModule<EndgeWorkspace>('workspace')
  }
}
