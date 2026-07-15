import { EndgeFederation } from '@/domain/entities/endge/EndgeFederation'
import type { EndgeBootContext } from '@/domain/types/kernel/bootstrap.types'
import type { EndgeDomainBundle } from '@/domain/types/document/domain-export.type'
import type { EndgeAuth } from '@/model/endge/security/endge-auth'
import type { EndgeAuthProfiles } from '@/model/endge/security/endge-auth-profiles'
import { EndgeBind } from '@/model/endge/runtime/core/endge-bind'
import { EndgeCommands } from '@/model/endge/runtime/core/endge-commands'
import { EndgeConsole } from '@/model/endge/diagnostics/endge-console'
import { EndgeContext } from '@/model/endge/context/endge-context'
import { EndgeDataView } from '@/model/endge/runtime/execution/endge-data-view'
import { EndgeCompiler } from '@/model/endge/program/endge-compiler'
import { EndgeDebug } from '@/model/endge/diagnostics/endge-debug'
import { EndgeDiagnostics } from '@/model/endge/diagnostics/endge-diagnostics'
import { EndgeDomain } from '@/model/endge/domain/endge-domain'
import { EndgeEvents } from '@/model/endge/kernel/endge-events'
import { EndgeFlow } from '@/model/endge/runtime/flow/endge-flow'
import { EndgeFlowRegistry } from '@/model/endge/runtime/flow/endge-flow-registry'
import { EndgeI18n } from '@/model/endge/context/endge-i18n'
import type { EndgeMock } from '@/model/endge/mock/EndgeMock'
import { EndgeProgram } from '@/model/endge/program/endge-program'
import { EndgeQuery } from '@/model/endge/runtime/execution/endge-query'
import { EndgeRuntime } from '@/model/endge/runtime/core/endge-runtime'
import { EndgeRuntimeDebugger } from '@/model/endge/diagnostics/endge-runtime-debugger'
import { EndgeSchemaStorage } from '@/model/endge/schema/endge-schema-database'
import { EndgeSource } from '@/model/endge/program/endge-source'
import { EndgeSSE } from '@/model/endge/runtime/input/endge-sse'
import { EndgeStyles } from '@/model/endge/ui/endge-styles'
import { EndgeUI } from '@/model/endge/ui/endge-ui'
import { EndgeUpdates } from '@/model/endge/runtime/core/endge-updates'
import type { WorkspaceVariables } from '@/model/endge/context/endge-vars'
import { EndgeVocabs } from '@/model/endge/domain/endge-vocabs'
import { EndgeWorkspace } from '@/model/endge/context/endge-workspace'
import { EndgeUIRegistry } from '@/model/endge/ui/endge-ui-registry'
import { ENDGE_CORE_MODULES } from '@/model/config/endge-modules'
import type { EndgeComposition } from '@/model/endge/runtime/execution/endge-composition'

const ENDGE_DOMAIN_BUNDLE_VERSION = '1.1.0'

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
   * Собирает переносимый snapshot workspace и текущего домена.
   */
  static exportDomainBundle(): EndgeDomainBundle {
    const workspace = Endge.workspace.serialize()
    const sse = workspace.sse ? { ...workspace.sse } : undefined
    if (sse)
      delete sse.manualToken

    return {
      domain: Endge.domain.toPlain(),
      version: ENDGE_DOMAIN_BUNDLE_VERSION,
      workspace: {
        ...workspace,
        ...(sse ? { sse } : {}),
      },
    }
  }

  /**
   * Скачивает текущий workspace и домен как JSON-файл через браузерный download.
   */
  static async download(): Promise<void> {
    const bundle = this.exportDomainBundle()
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
   * @deprecated Используйте Endge.runtime.flowRegistry.
   */
  static get flowRegistry(): EndgeFlowRegistry {
    return this.runtime.flowRegistry
  }

  /**
   * @deprecated Используйте Endge.runtime.flow.
   */
  static get flow(): EndgeFlow {
    return this.runtime.flow
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
   * @deprecated Используйте Endge.auth.profiles.
   */
  static get authProfiles(): EndgeAuthProfiles {
    return this.auth.profiles
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
   * Доступ к registry runtime bindings.
   */
  static get bind(): EndgeBind {
    return this.getModule<EndgeBind>('bind')
  }

  /**
   * @deprecated Используйте Endge.runtime.commands.
   */
  static get commands(): EndgeCommands {
    return this.runtime.commands
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
