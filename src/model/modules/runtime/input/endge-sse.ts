import type { Nullable } from '@endge/utils'

import {
  NamedExecutor,
  SSEManager,
  UPSMeter_Service,
} from '@endge/utils'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/kernel/endge'

type EndgeSSEConfig = {
  url: string
  authMode?: 'inherit' | 'profile' | 'none'
  authProfileIdentity?: string | null
}

/**
 * Модуль подключения к SSE-каналу и трансляции сообщений в Endge events.
 */
export class EndgeSSE extends EndgeModule {
  private _sseManager: Nullable<SSEManager> = null

  private readonly _delayExecutor: NamedExecutor
  private readonly _upsMeter: UPSMeter_Service = new UPSMeter_Service()

  private _forceRefreshOnReconnect = false

  /**
   * Создает SSE-модуль и delayed executor для пакетного уведомления подписчиков.
   */
  public constructor() {
    super()

    this._delayExecutor = new NamedExecutor({
      delayMs: 300,
      maxMs: 1000,
      onAfterFlush: (): void => this.notify(),
    })
  }

  /**
   * Предметный запуск SSE-подключения из внешнего кода.
   */
  public async init(): Promise<void> {
    // console.log('[EndgeSSE] init')
    await this.startSSE()
  }

  /**
   * Сбрасывает SSE-подключение, delayed tasks и счетчик сообщений.
   */
  public reset(): void {
    // console.log('[EndgeSSE] reset')
    this._delayExecutor.flushAll()
    this.stopSSE()
    this._upsMeter.reset()
  }

  /**
   * Запускает SSE-подключение по настройкам из домена.
   */
  public async startSSE(): Promise<void> {
    // console.group('[EndgeSSE] startSSE')

    const cfg: EndgeSSEConfig | undefined = Endge.workspace.sse
    if (!cfg?.url) {
      console.warn('[EndgeSSE] sse url is empty')
      // console.groupEnd()
      return
    }

    const url: string = String(Endge.workspace.variables.resolve(cfg.url) ?? cfg.url).trim()
    if (!url) {
      console.warn('[EndgeSSE] resolved sse url is empty')
      // console.groupEnd()
      return
    }

    // console.log('[EndgeSSE] url:', url)
    // console.log('[EndgeSSE] sse cfg:', cfg)

    this.stopSSE()
    this._sseManager = new SSEManager({
      url,
      retryInterval: 5000,

      getToken: async (): Promise<string | undefined> => {
        const mode = cfg.authMode ?? 'inherit'
        if (mode === 'none')
          return undefined
        const forceRefresh = this._forceRefreshOnReconnect
        const session = await Endge.auth.requests.resolve(
          mode === 'profile'
            ? { mode: 'profile', profileIdentity: String(cfg.authProfileIdentity ?? '').trim() }
            : { mode: 'inherit' },
          { forceRefresh },
        )
        this._forceRefreshOnReconnect = false
        return session.accessToken
      },

      onEvent: (message: unknown): void => {
        this.emitCustomSSEEvent(message)
      },
      onError: (error: Error): void => {
        if (isUnauthorizedSseError(error))
          this._forceRefreshOnReconnect = true
      },
    })

    this._sseManager.start()
    // console.log('[EndgeSSE] started')

  }

  /**
   * Публикует входящее SSE-сообщение в `Endge.events`.
   */
  public emitCustomSSEEvent(message: unknown): void {
    if (!message)
      return
    this._upsMeter.count()

    //
    //
    Endge.events.emitEvent('sse:message', {
      message,
    })
  }

  /**
   * Останавливает активное SSE-подключение и очистку token-cache.
   */
  public stopSSE(): void {
    // console.log('[EndgeSSE] stopSSE')

    if (this._sseManager) {
      this._sseManager.stop()
      this._sseManager = null
    }

    this._forceRefreshOnReconnect = false
  }

  /**
   * Переключает SSE-подключение между active и stopped.
   */
  public toggleSSE(): void {
    if (this.isSSEActive) {
      this.stopSSE()
    }
    else {
      void this.startSSE()
    }
  }

  /**
   * Возвращает текущую скорость входящих SSE-сообщений.
   */
  public get sseRate(): number {
    if (!this._sseManager)
      return 0
    return this._upsMeter.rate
  }

  /**
   * Показывает, активно ли SSE-подключение.
   */
  public get isSSEActive(): boolean {
    return this._sseManager !== null && this._sseManager.isConnected
  }

}

function isUnauthorizedSseError(error: unknown): boolean {
  return /unexpected response:\s*(401|403)\b/i.test(String((error as Error | undefined)?.message ?? error))
}
