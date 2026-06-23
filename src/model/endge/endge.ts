import { Raph } from '@endge/raph'

import { EndgeFederation } from '@/domain/entities/endge/EndgeFederation'
import { EndgeApp } from '@/model/endge/endge-app'
import { EndgeAuth } from '@/model/endge/endge-auth'
import { EndgeBindingsBehavior } from '@/model/endge/endge-bindings-behavior'
import { EndgeBind } from '@/model/endge/endge-bind'
import { EndgeBootstrap } from '@/model/endge/endge-bootstrap'
import { EndgeConsole } from '@/model/endge/endge-console'
import { EndgeContracts } from '@/model/endge/endge-contracts'
import { EndgeDebug } from '@/model/endge/endge-debug'
import { EndgeDiagnostics } from '@/model/endge/endge-diagnostics'
import { EndgeDomain } from '@/model/endge/endge-domain'
import { EndgeEvents } from '@/model/endge/endge-events'
import { EndgeExtract } from '@/model/endge/endge-extract'
import { EndgeFlow } from '@/model/endge/endge-flow'
import { EndgeFlowRegistry } from '@/model/endge/endge-flow-registry'
import { EndgeBindingsPresentation } from '@/model/endge/endge-bindings-presentation'
import { EndgeQuery } from '@/model/endge/endge-query'
import { EndgeRender } from '@/model/endge/endge-render'
import { EndgeReports } from '@/model/endge/endge-reports'
import { EndgeRuntime } from '@/model/endge/endge-runtime'
import { EndgeRuntimeDebugger } from '@/model/endge/endge-runtime-debugger'
import { EndgeSchemaStorage } from '@/model/endge/endge-schema-database'
import { EndgeScript } from '@/model/endge/endge-script'
import { EndgeSSE } from '@/model/endge/endge-sse'
import { EndgeStore } from '@/model/endge/endge-store'
import { EndgeStyles } from '@/model/endge/endge-styles'
import { EndgeTesting } from '@/model/endge/endge-testing'
import { EndgeUI } from '@/model/endge/endge-ui'
import { EndgeUpdates } from '@/model/endge/endge-updates'
import { EndgeVars } from '@/model/endge/endge-vars'
import { EndgeVocabs } from '@/model/endge/endge-vocabs'
import { EndgeUIRegistry } from '@/model/endge/endge-ui-registry'
import { consoleLog } from '@/model/seed/actions/console_log'
import { loadVocabs } from '@/model/seed/actions/load_vocabs'
import { split } from '@/model/seed/converters/arrays/split'
import { toArray } from '@/model/seed/converters/arrays/to-array'
import { dateToDateString } from '@/model/seed/converters/date/date-to-date-string'
import { dateToIsoString } from '@/model/seed/converters/date/date-to-iso-string'
import { dateToIsoZ } from '@/model/seed/converters/date/date-to-iso-z'
import { dateToTimeString } from '@/model/seed/converters/date/date-to-time-string'
import { isoStringToDate } from '@/model/seed/converters/date/iso-string-to-date'
import { isoStringToTimeString } from '@/model/seed/converters/date/iso-string-to-time-string'
import { stringToDate } from '@/model/seed/converters/date/string-to-date'
import { timeStringToDate } from '@/model/seed/converters/date/time-string-to-date'
import { timestampToDate } from '@/model/seed/converters/date/timestamp-to-date'
import { weekdaysRange } from '@/model/seed/converters/date/weekdays-range'
import { jsonParse } from '@/model/seed/converters/json/json-parse'
import { jsonStringify } from '@/model/seed/converters/json/json-stringify'
import { numberToString } from '@/model/seed/converters/numbers/number-to-string'
import { stringToNumber } from '@/model/seed/converters/numbers/string-to-number'
import { defaultIfEmpty } from '@/model/seed/converters/strings/default-if-empty'
import { stringToBoolean } from '@/model/seed/converters/strings/string-to-boolean'
import { stringTrim } from '@/model/seed/converters/strings/string-trim'

/**
 * Единая статическая федерация Endge.
 * Хост живёт в `globalThis`, поэтому `Endge` не дублируется даже если пакет подтянут из разных зависимостей.
 */
export class Endge extends EndgeFederation {
  protected static override readonly federationId = 'endge'

  /** Запрещаем `new Endge()` - работаем только через статическое API */
  private constructor() {
    super()
  }

  protected static override configureFederation(): void {
    this.registerModule('app', new EndgeApp())
    this.registerModule('bootstrap', new EndgeBootstrap())
    this.registerModule('diagnostics', new EndgeDiagnostics())
    this.registerModule('debug', new EndgeDebug())
    this.registerModule('testing', new EndgeTesting())
    this.registerModule('domain', new EndgeDomain())
    this.registerModule('vocabs', new EndgeVocabs())
    this.registerModule('extract', new EndgeExtract())
    this.registerModule('flowRegistry', new EndgeFlowRegistry())
    this.registerModule('flow', new EndgeFlow())
    this.registerModule('render', new EndgeRender())
    this.registerModule('store', new EndgeStore())
    this.registerModule('script', new EndgeScript())
    this.registerModule('runtime', new EndgeRuntime())
    this.registerModule('vars', new EndgeVars())
    this.registerModule('query', new EndgeQuery())
    this.registerModule('auth', new EndgeAuth())
    this.registerModule('schema', new EndgeSchemaStorage())
    this.registerModule('updates', new EndgeUpdates())
    this.registerModule('events', new EndgeEvents())
    this.registerModule('sse', new EndgeSSE())
    this.registerModule('ui', new EndgeUI())
    this.registerModule('uiRegistry', new EndgeUIRegistry())
    this.registerModule('reports', new EndgeReports())
    this.registerModule('bind', new EndgeBind())
    this.registerModule('console', new EndgeConsole())
    this.registerModule('runtimeDebugger', new EndgeRuntimeDebugger())
    this.registerModule('styles', new EndgeStyles())

    //
    // Faceted cascade
    this.registerModule('contracts', new EndgeContracts())
    this.registerModule('behaviorBindings', new EndgeBindingsBehavior())
    this.registerModule('presentationBindings', new EndgeBindingsPresentation())
  }

  static get debug(): EndgeDebug {
    return this.getModule<EndgeDebug>('debug')
  }

  static get diagnostics(): EndgeDiagnostics {
    return this.getModule<EndgeDiagnostics>('diagnostics')
  }

  static get bootstrap(): EndgeBootstrap {
    return this.getModule<EndgeBootstrap>('bootstrap')
  }

  static get testing(): EndgeTesting {
    return this.getModule<EndgeTesting>('testing')
  }

  static get domain(): EndgeDomain {
    return this.getModule<EndgeDomain>('domain')
  }

  static get vocabs(): EndgeVocabs {
    return this.getModule<EndgeVocabs>('vocabs')
  }

  static get extract(): EndgeExtract {
    return this.getModule<EndgeExtract>('extract')
  }

  static get flowRegistry(): EndgeFlowRegistry {
    return this.getModule<EndgeFlowRegistry>('flowRegistry')
  }

  static get flow(): EndgeFlow {
    return this.getModule<EndgeFlow>('flow')
  }

  static get render(): EndgeRender {
    return this.getModule<EndgeRender>('render')
  }

  static get store(): EndgeStore {
    return this.getModule<EndgeStore>('store')
  }

  static get script(): EndgeScript {
    return this.getModule<EndgeScript>('script')
  }

  static get runtime(): EndgeRuntime {
    return this.getModule<EndgeRuntime>('runtime')
  }

  static get vars(): EndgeVars {
    return this.getModule<EndgeVars>('vars')
  }

  static get query(): EndgeQuery {
    return this.getModule<EndgeQuery>('query')
  }

  static get auth(): EndgeAuth {
    return this.getModule<EndgeAuth>('auth')
  }

  static get schema(): EndgeSchemaStorage {
    return this.getModule<EndgeSchemaStorage>('schema')
  }

  static get updates(): EndgeUpdates {
    return this.getModule<EndgeUpdates>('updates')
  }

  /** ACCESS */
  static get contracts(): EndgeContracts {
    return this.getModule<EndgeContracts>('contracts')
  }

  /** @deprecated Используйте Endge.contracts. */
  static get eventContracts(): EndgeContracts {
    return this.contracts
  }

  static get behaviorBindings(): EndgeBindingsBehavior {
    return this.getModule<EndgeBindingsBehavior>('behaviorBindings')
  }

  static get presentationBindings(): EndgeBindingsPresentation {
    return this.getModule<EndgeBindingsPresentation>('presentationBindings')
  }

  static get events(): EndgeEvents {
    return this.getModule<EndgeEvents>('events')
  }

  static get sse(): EndgeSSE {
    return this.getModule<EndgeSSE>('sse')
  }

  static get ui(): EndgeUI {
    return this.getModule<EndgeUI>('ui')
  }

  static get uiRegistry(): EndgeUIRegistry {
    return this.getModule<EndgeUIRegistry>('uiRegistry')
  }

  static get reports(): EndgeReports {
    return this.getModule<EndgeReports>('reports')
  }

  static get bind(): EndgeBind {
    return this.getModule<EndgeBind>('bind')
  }

  static get console(): EndgeConsole {
    return this.getModule<EndgeConsole>('console')
  }

  static get runtimeDebugger(): EndgeRuntimeDebugger {
    return this.getModule<EndgeRuntimeDebugger>('runtimeDebugger')
  }

  static get styles(): EndgeStyles {
    return this.getModule<EndgeStyles>('styles')
  }

  static get app(): EndgeApp {
    return this.getModule<EndgeApp>('app')
  }

  /** @deprecated Используйте Endge.app (getCurrentProject/setCurrentProject). */
  static get project(): EndgeApp {
    return this.app
  }

  static async setupWithPayload(opts: {
    payloadBaseAPI: string
    payloadSecret: string
  }): Promise<void> {
    await Endge.schema.init({
      payloadBaseAPI: opts.payloadBaseAPI,
      payloadSecret: opts.payloadSecret,
    })
  }

  static async init(opts: {
    debug: boolean
    provider: 'payload' | 'plain'
    payloadBaseAPI?: string
    payloadSecret?: string
    plainDomain?: any
    vars: Record<string, any>
  }): Promise<void> {
    await this.runInitialization(async () => {
      Endge.app.isDebug = opts.debug || false

      await this.setup()
      this.configureRaph()

      Endge.vars.setEnvyRecord(opts.vars)

      if (opts.provider === 'plain') {
        Endge.domain.merge(opts.plainDomain)
        Endge.domain.compile()
      }
      else {
        await this.initializePayloadDomain({
          payloadBaseAPI: opts.payloadBaseAPI!,
          payloadSecret: opts.payloadSecret!,
        })
      }

      await this.initModules()

      Endge.styles.init(Endge.domain)

      Endge.console.register('raph', () => { console.log(Raph.data) }, 'Текущее содержимое Raph')
      Endge.console.register('domain', () => { console.log(Endge.domain) }, 'Текущий домен Endge')
      Endge.console.exposeToGlobal()

      Raph.reinitPhases()

      this.hydrateRuntimeFilters()

      //
      // Converters
      Endge.bind.converter('to-array', toArray)
      Endge.bind.converter('split', split)
      Endge.bind.converter('iso-string-to-date', isoStringToDate)
      Endge.bind.converter('timestamp-to-date', timestampToDate)
      Endge.bind.converter('date-to-iso-string', dateToIsoString)
      Endge.bind.converter('date-to-iso-z', dateToIsoZ)
      Endge.bind.converter('string-to-date', stringToDate)
      Endge.bind.converter('date-to-date-string', dateToDateString)
      Endge.bind.converter('date-to-time-string', dateToTimeString)
      Endge.bind.converter('time-string-to-date', timeStringToDate)
      Endge.bind.converter('iso-string-to-time-string', isoStringToTimeString)
      Endge.bind.converter('weekdays-range', weekdaysRange)
      Endge.bind.converter('string-trim', stringTrim)
      Endge.bind.converter('default-if-empty', (value: unknown) => defaultIfEmpty(value))
      Endge.bind.converter('string-to-boolean', stringToBoolean)
      Endge.bind.converter('string-to-number', stringToNumber)
      Endge.bind.converter('number-to-string', numberToString)
      Endge.bind.converter('json-parse', jsonParse)
      Endge.bind.converter('json-stringify', jsonStringify)

      //
      // Actions
      for (const action of Endge.domain.getActions()) {
        Endge.bind.action(action, 'console-log', consoleLog)
        Endge.bind.action(action, 'load-vocabs', loadVocabs)
      }
    })
  }

  static async reset(): Promise<void> {
    await this.resetModules()
  }

  /**
   * Скачивание домена
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

  private static configureRaph(): void {
    Raph.options({ debug: true })
  }

  private static async initializePayloadDomain(opts: {
    payloadBaseAPI: string
    payloadSecret: string
  }): Promise<void> {
    await Endge.setupWithPayload(opts)
    await Endge.schema.hydrateDomain()
  }

  private static hydrateRuntimeFilters(): void {
    try {
      const raw = localStorage.getItem('endge:parameters')
      if (!raw) { return }

      const store = JSON.parse(raw) as Record<string, unknown>
      if (!store || typeof store !== 'object') { return }

      for (const [identity, payload] of Object.entries(store)) {
        if (!identity) { continue }

        Raph.set(
          identity.startsWith('parameters.') ? identity : `parameters.${identity}`,
          payload,
        )
      }
    }
    catch (error) {
      console.error(error)
    }
  }
}
