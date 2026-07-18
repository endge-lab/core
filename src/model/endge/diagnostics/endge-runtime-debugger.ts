import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import type { DiagnosticsRecord } from '@/domain/types/diagnostics/diagnostics.types'
import { Endge } from '@/model/endge/kernel/endge'

const CHANNEL_NAME = 'endge-runtime-debug'
const DIAGNOSTICS_RECORD_TYPE = 'diagnostics-record'
const STORAGE_KEY_TAB_ID = 'endge-runtime-debug-tab-id'
const REGISTER_INTERVAL_MS = 15000

/** Сериализация записи для postMessage (structured clone). */
function serializeRecordForChannel(record: DiagnosticsRecord): Record<string, unknown> {
  return JSON.parse(JSON.stringify(record)) as Record<string, unknown>
}

export interface RuntimeDebugTab {
  id: string
  url: string
  title: string
  at: number
}

function isAdminUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.pathname.includes('/admin')
  }
  catch {
    return false
  }
}

/**
 * Подключает вкладку к каналу обмена для отладки.
 * start() - создаёт канал и слушает регистрации (вызывать в админке).
 * activate() - регистрирует текущую вкладку как клиент Runtime Debug.
 */
export class EndgeRuntimeDebugger extends EndgeModule {
  /** Канал для отправки (activate) */
  private _channel: BroadcastChannel | null = null
  /** Канал для приёма (start); живёт глобально в админке */
  private _listenerChannel: BroadcastChannel | null = null
  private _tabId: string | null = null
  private _tabs: RuntimeDebugTab[] = []
  private _autoRegisterTimer: number | null = null
  private _analysisByTabId: Record<string, string[]> = {}
  private _diagnosticsListener: ((record: DiagnosticsRecord) => void) | null = null
  private _unsubscribeDiagnostics: (() => void) | null = null

  /** Закрывает browser channels, timers и diagnostics subscription. */
  public override reset(): void {
    this.stop()
    if (this._channel) {
      this._channel.removeEventListener('message', this._onClientMessage)
      this._channel.close()
      this._channel = null
    }
    if (this._autoRegisterTimer != null && typeof window !== 'undefined')
      window.clearInterval(this._autoRegisterTimer)
    this._autoRegisterTimer = null
    this._unsubscribeDiagnostics?.()
    this._unsubscribeDiagnostics = null
    this._diagnosticsListener = null
    this._tabId = null
    this._analysisByTabId = {}
  }

  /** Доступ к текущему состоянию runtime debugger. */

  /**
   * Возвращает список вкладок, известных runtime debugger.
   */
  public get tabs(): RuntimeDebugTab[] {
    return this._tabs
  }

  /**
   * Показывает, открыт ли BroadcastChannel для runtime debug.
   */
  public get isListening(): boolean {
    return this._listenerChannel != null
  }

  /**
   * Возвращает накопленные результаты анализа для вкладки.
   */
  public getAnalysis(tabId: string): string[] {
    const key = String(tabId ?? '')
    if (!key)
      return []
    return this._analysisByTabId[key] ?? []
  }

  /**
   * Отправить команду во все подключённые вкладки.
   * Используется админкой для запуска анализа по текущей вкладке.
   */
  public sendCommand(command: string, payload?: Record<string, unknown>): void {
    if (typeof BroadcastChannel === 'undefined')
      return
    const ch = this._getChannel()
    ch.postMessage({
      type: 'command',
      command,
      payload: payload ?? {},
      at: Date.now(),
    })
  }

  /**
   * Запустить прослушку канала (создать канал и накапливать вкладки). Вызывать из админки при init.
   */
  public startListening(): void {
    if (typeof BroadcastChannel === 'undefined' || this._listenerChannel != null)
      return
    console.log('[EndgeRuntimeDebugger] start: создаём канал прослушки', CHANNEL_NAME)
    this._listenerChannel = new BroadcastChannel(CHANNEL_NAME)
    this._listenerChannel.addEventListener('message', this._onMessage)
    this.notify()
  }

  /**
   * Остановить прослушку, закрыть канал, очистить список вкладок.
   */
  public stop(): void {
    if (this._listenerChannel) {
      this._listenerChannel.removeEventListener('message', this._onMessage)
      this._listenerChannel.close()
      this._listenerChannel = null
    }
    this._tabs = []
    this.notify()
  }

  private _onMessage = (e: MessageEvent): void => {
    const data = e.data
    if (!data?.type)
      return

    if (data.type === 'register') {
      if (!data.id)
        return
      const tab: RuntimeDebugTab = {
        id: data.id,
        url: data.url ?? '',
        title: data.title ?? '',
        at: data.at ?? Date.now(),
      }
      const idx = this._tabs.findIndex(t => t.id === tab.id)
      if (idx >= 0) {
        this._tabs.splice(idx, 1, tab)
        console.debug('[EndgeRuntimeDebugger] register: обновление вкладки', tab)
      }
      else {
        this._tabs.push(tab)
        console.log('[EndgeRuntimeDebugger] register: новая вкладка', tab)
      }
      this.notify()
      return
    }

    if (data.type === 'analysis-result') {
      const tabId = String(data.tabId ?? '')
      if (!tabId)
        return
      const rawTargets = Array.isArray(data.targets) ? data.targets : []
      const targets = rawTargets
        .map((t: unknown) => String(t ?? '').trim())
        .filter((t: string) => t.length > 0)
      this._analysisByTabId[tabId] = targets
      console.log('[EndgeRuntimeDebugger] analysis-result: получены цели', {
        tabId,
        targets,
      })
      this.notify()
    }
  }

  /**
   * Возвращает Channel.
   */
  private _getChannel(): BroadcastChannel {
    if (!this._channel) {
      this._channel = new BroadcastChannel(CHANNEL_NAME)
      this._channel.addEventListener('message', this._onClientMessage)
    }
    return this._channel
  }

  /**
   * Возвращает Tab Id.
   */
  private _getTabId(): string {
    if (this._tabId)
      return this._tabId
    try {
      let id = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(STORAGE_KEY_TAB_ID) : null
      if (!id) {
        id = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        sessionStorage?.setItem(STORAGE_KEY_TAB_ID, id)
      }
      this._tabId = id
      return id
    }
    catch {
      this._tabId = `tab-${Date.now()}`
      return this._tabId
    }
  }

  /**
   * Внутренний helper модуля: post Register.
   */
  private _postRegister(): void {
    if (typeof BroadcastChannel === 'undefined')
      return
    const ch = this._getChannel()
    const id = this._getTabId()
    ch.postMessage({
      type: 'register',
      id,
      url: typeof location !== 'undefined' ? location.href : '',
      title: typeof document !== 'undefined' ? document.title : '',
      at: Date.now(),
    })
  }

  /**
   * Обработка команд на стороне клиентской вкладки.
   * Здесь просто логируем получение команды для отладки.
   */
  private _onClientMessage = (e: MessageEvent): void => {
    const data = e.data
    if (data?.type !== 'command')
      return

    // В админке команды не обрабатываем как клиентские
    if (typeof location !== 'undefined' && isAdminUrl(location.href))
      return

    const currentTabId = this._getTabId()
    const targetTabId = data.payload?.tabId as string | undefined

    if (targetTabId && targetTabId !== currentTabId)
      return

    // Базовый лог о том, что команда дошла до клиента
    console.log('[EndgeRuntimeDebugger] команда получена в клиенте', {
      command: data.command,
      payload: data.payload,
      tabId: currentTabId,
    })

    if (data.command === 'template-analysis') {
      console.log('[EndgeRuntimeDebugger] template-analysis: команда анализа шаблона получена', {
        tabId: currentTabId,
        payload: data.payload,
      })

      if (typeof document !== 'undefined') {
        const nodes = document.querySelectorAll<HTMLElement>('[data-type="endge-layout-area"][data-target]')
        const targetsSet = new Set<string>()
        nodes.forEach((el) => {
          const value = el.getAttribute('data-target')?.trim()
          if (value)
            targetsSet.add(value)
        })
        const targets = Array.from(targetsSet)

        const ch = this._getChannel()
        ch.postMessage({
          type: 'analysis-result',
          tabId: currentTabId,
          url: typeof location !== 'undefined' ? location.href : '',
          targets,
          at: Date.now(),
        })

        console.log('[EndgeRuntimeDebugger] template-analysis: отправлен результат анализа', {
          tabId: currentTabId,
          targets,
        })
      }
    }
  }

  /**
   * Гарантирует Auto Register.
   */
  private _ensureAutoRegister(): void {
    if (this._autoRegisterTimer != null)
      return
    if (typeof window === 'undefined')
      return
    this._autoRegisterTimer = window.setInterval(() => {
      try {
        this._postRegister()
      }
      catch {
        // игнорируем ошибки при попытке повторной регистрации
      }
    }, REGISTER_INTERVAL_MS)
  }

  /**
   * Зарегистрировать текущую вкладку в канале отладки.
   * При активации подписывается на Endge.diagnostics и дублирует записи в канал для админки.
   */
  public activate(): void {
    this._postRegister()
    this._ensureAutoRegister()
    this._ensureDiagnosticsForwarding()
    console.log('DebugTab активирован')
  }

  /** Один раз подписаться на diagnostics и слать записи в канал. Не делаем на странице админки. */
  /**
   * Гарантирует Diagnostics Forwarding.
   */
  private _ensureDiagnosticsForwarding(): void {
    if (this._diagnosticsListener != null)
      return
    if (typeof location !== 'undefined' && isAdminUrl(location.href))
      return
    const listener = (record: DiagnosticsRecord): void => {
      if (typeof BroadcastChannel === 'undefined')
        return
      try {
        const ch = this._getChannel()
        const payload = {
          type: DIAGNOSTICS_RECORD_TYPE,
          tabId: this._getTabId(),
          url: typeof location !== 'undefined' ? location.href : '',
          title: typeof document !== 'undefined' ? document.title : '',
          record: serializeRecordForChannel(record),
          at: Date.now(),
        }
        ch.postMessage(payload)
      }
      catch {
        // игнорируем ошибки сериализации/отправки
      }
    }
    this._diagnosticsListener = listener
    this._unsubscribeDiagnostics = Endge.diagnostics.subscribe({}, listener)
  }
}
