import { EndgeFederation } from '@/domain/entities/endge/EndgeFederation'
import type { EndgeBootContext } from '@/domain/types/bootstrap.types'
import type { EndgeAuth } from '@/model/endge/endge-auth'
import type { EndgeAuthProfiles } from '@/model/endge/endge-auth-profiles'
import { EndgeBindingsBehavior } from '@/model/endge/endge-bindings-behavior'
import { EndgeBind } from '@/model/endge/endge-bind'
import { EndgeCommands } from '@/model/endge/endge-commands'
import { EndgeConsole } from '@/model/endge/endge-console'
import { EndgeContext } from '@/model/endge/endge-context'
import { EndgeContracts } from '@/model/endge/endge-contracts'
import { EndgeDataView } from '@/model/endge/endge-data-view'
import { EndgeCompiler } from '@/model/endge/endge-compiler'
import { EndgeDebug } from '@/model/endge/endge-debug'
import { EndgeDiagnostics } from '@/model/endge/endge-diagnostics'
import { EndgeDomain } from '@/model/endge/endge-domain'
import { EndgeEvents } from '@/model/endge/endge-events'
import { EndgeExtract } from '@/model/endge/endge-extract'
import { EndgeFlow } from '@/model/endge/endge-flow'
import { EndgeFlowRegistry } from '@/model/endge/endge-flow-registry'
import { EndgeBindingsPresentation } from '@/model/endge/endge-bindings-presentation'
import { EndgeI18n } from '@/model/endge/endge-i18n'
import { EndgeProgram } from '@/model/endge/endge-program'
import { EndgeQuery } from '@/model/endge/endge-query'
import { EndgeRender } from '@/model/endge/endge-render'
import { EndgeReports } from '@/model/endge/endge-reports'
import { EndgeRuntime } from '@/model/endge/endge-runtime'
import { EndgeRuntimeDebugger } from '@/model/endge/endge-runtime-debugger'
import { EndgeSchemaStorage } from '@/model/endge/endge-schema-database'
import { EndgeScript } from '@/model/endge/endge-script'
import { EndgeSource } from '@/model/endge/endge-source'
import { EndgeSSE } from '@/model/endge/endge-sse'
import { EndgeStore } from '@/model/endge/endge-store'
import { EndgeStyles } from '@/model/endge/endge-styles'
import { EndgeTesting } from '@/model/endge/endge-testing'
import { EndgeUI } from '@/model/endge/endge-ui'
import { EndgeUpdates } from '@/model/endge/endge-updates'
import { EndgeVars } from '@/model/endge/endge-vars'
import { EndgeVocabs } from '@/model/endge/endge-vocabs'
import { EndgeWorkspace } from '@/model/endge/endge-workspace'
import { EndgeUIRegistry } from '@/model/endge/endge-ui-registry'
import { ENDGE_CORE_MODULES } from '@/model/config/endge-modules'

/**
 * Единая статическая федерация Endge.
 * Хост живёт в `globalThis`, поэтому `Endge` не дублируется даже если пакет подтянут из разных зависимостей.
 */
export class Endge extends EndgeFederation {
  protected static override readonly federationId = 'endge'

  /**
   * Запрещает создание экземпляров `Endge`.
   * Федерация используется только через статический facade.
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
      this.defineModule({
        key: item.key,
        module: new item.module(),
        before: item.before,
        after: item.after,
      })
    }
  }

  /**
   * Запускает ядро по полному boot pipeline: `setup -> load -> build -> start`.
   * Метод является единственной централизованной точкой старта `Endge`.
   */
  static override async boot(ctx: EndgeBootContext): Promise<void> {
    if (this.isInitialized)
      return

    Endge.debug.enabled = true
    await super.boot(ctx)
  }

  /**
   * Скачивает текущий домен как JSON-файл через браузерный download.
   */
  static async download(): Promise<void> {
    const bundle = {
      domain: Endge.domain.toPlain(),
      version: '1.0.0',
    }
    const jsonString = JSON.stringify(bundle)

    const now = new Date()
    const timestamp = now.toISOString().replace(/:/g, '-').replace(/\..+/, '')

    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)

    const a = document.createElement('a')
    a.href = url
    a.download = `endge-domain-${timestamp}.json`
    a.click()

    URL.revokeObjectURL(url)
  }

  /**
   * Доступ к модулю debug-логирования.
   */
  static get debug(): EndgeDebug {
    return this.getModule<EndgeDebug>('debug')
  }

  /**
   * Доступ к модулю диагностических событий, трасс и snapshots.
   */
  static get diagnostics(): EndgeDiagnostics {
    return this.getModule<EndgeDiagnostics>('diagnostics')
  }

  /**
   * Доступ к модулю тестовых вспомогательных сценариев.
   */
  static get testing(): EndgeTesting {
    return this.getModule<EndgeTesting>('testing')
  }

  /**
   * Доступ к persisted domain model.
   */
  static get domain(): EndgeDomain {
    return this.getModule<EndgeDomain>('domain')
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
   * Доступ к модулю извлечения значений из доменных и runtime-структур.
   */
  static get extract(): EndgeExtract {
    return this.getModule<EndgeExtract>('extract')
  }

  /**
   * Доступ к registry flow handlers.
   */
  static get flowRegistry(): EndgeFlowRegistry {
    return this.getModule<EndgeFlowRegistry>('flowRegistry')
  }

  /**
   * Доступ к модулю выполнения flow/action сценариев.
   */
  static get flow(): EndgeFlow {
    return this.getModule<EndgeFlow>('flow')
  }

  /**
   * Доступ к модулю render-операций.
   */
  static get render(): EndgeRender {
    return this.getModule<EndgeRender>('render')
  }

  /**
   * Доступ к runtime store.
   */
  static get store(): EndgeStore {
    return this.getModule<EndgeStore>('store')
  }

  /**
   * Доступ к модулю выполнения пользовательских scripts.
   */
  static get script(): EndgeScript {
    return this.getModule<EndgeScript>('script')
  }

  /**
   * Доступ к runtime host manager.
   */
  static get runtime(): EndgeRuntime {
    return this.getModule<EndgeRuntime>('runtime')
  }

  /**
   * Доступ к модулю runtime/env variables.
   */
  static get vars(): EndgeVars {
    return this.getModule<EndgeVars>('vars')
  }

  /**
   * Доступ к модулю выполнения query.
   */
  static get query(): EndgeQuery {
    return this.getModule<EndgeQuery>('query')
  }

  /**
   * Доступ к модулю выполнения DataView transformations.
   */
  static get dataView(): EndgeDataView {
    return this.getModule<EndgeDataView>('dataView')
  }

  /**
   * Доступ к auth-модулю.
   */
  static get auth(): EndgeAuth {
    return this.getModule<EndgeAuth>('auth')
  }

  /**
   * Доступ к профилям авторизации и adapter registry.
   */
  static get authProfiles(): EndgeAuthProfiles {
    return this.getModule<EndgeAuthProfiles>('authProfiles')
  }

  /**
   * Доступ к schema storage и Payload-интеграции.
   */
  static get schema(): EndgeSchemaStorage {
    return this.getModule<EndgeSchemaStorage>('schema')
  }

  /**
   * Доступ к модулю приема updates.
   */
  static get updates(): EndgeUpdates {
    return this.getModule<EndgeUpdates>('updates')
  }

  /**
   * Доступ к contracts registry.
   */
  static get contracts(): EndgeContracts {
    return this.getModule<EndgeContracts>('contracts')
  }

  /**
   * Доступ к contracts registry через старое имя.
   * @deprecated Используйте Endge.contracts.
   */
  static get eventContracts(): EndgeContracts {
    return this.contracts
  }

  /**
   * Доступ к resolver поведения по behavior bindings.
   */
  static get behaviorBindings(): EndgeBindingsBehavior {
    return this.getModule<EndgeBindingsBehavior>('behaviorBindings')
  }

  /**
   * Доступ к resolver презентации по presentation bindings.
   */
  static get presentationBindings(): EndgeBindingsPresentation {
    return this.getModule<EndgeBindingsPresentation>('presentationBindings')
  }

  /**
   * Доступ к event bus модулю.
   */
  static get events(): EndgeEvents {
    return this.getModule<EndgeEvents>('events')
  }

  /**
   * Доступ к SSE-модулю.
   */
  static get sse(): EndgeSSE {
    return this.getModule<EndgeSSE>('sse')
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

  /**
   * Доступ к модулю отчетов.
   */
  static get reports(): EndgeReports {
    return this.getModule<EndgeReports>('reports')
  }

  /**
   * Доступ к registry runtime bindings.
   */
  static get bind(): EndgeBind {
    return this.getModule<EndgeBind>('bind')
  }

  /**
   * Доступ к runtime command registry.
   */
  static get commands(): EndgeCommands {
    return this.getModule<EndgeCommands>('commands')
  }

  /**
   * Доступ к консольным debug-командам.
   */
  static get console(): EndgeConsole {
    return this.getModule<EndgeConsole>('console')
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

  /**
   * Доступ к frontend workspace profile: локали и будущие runtime capabilities.
   */
  static get workspace(): EndgeWorkspace {
    return this.getModule<EndgeWorkspace>('workspace')
  }
}
