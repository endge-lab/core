import type {
  SettingsSSEAuthMode,
  SettingsSSESchema,
} from '@/domain/types/settings.types'
import type { Nullable } from '@endge/utils'

import {
  NamedExecutor,
  SSEManager,
  UPSMeter_Service,
} from '@endge/utils'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/endge'

export class EndgeSSE extends EndgeModule {
  private _sseManager: Nullable<SSEManager> = null

  private readonly _delayExecutor: NamedExecutor
  private readonly _upsMeter: UPSMeter_Service = new UPSMeter_Service()

  private _tokenCached: string | undefined
  private _tokenRefreshTimer: Nullable<ReturnType<typeof setInterval>> = null

  public constructor() {
    super()

    this._delayExecutor = new NamedExecutor({
      delayMs: 300,
      maxMs: 1000,
      onAfterFlush: (): void => this.notify(),
    })
  }

  public async init(): Promise<void> {
    // console.log('[EndgeSSE] init')
    await this.startSSE()
  }

  public reset(): void {
    // console.log('[EndgeSSE] reset')
    this._delayExecutor.flushAll()
    this.stopSSE()
    this._upsMeter.reset()
  }

  public async startSSE(): Promise<void> {
    // console.group('[EndgeSSE] startSSE')

    const settings = Endge.domain.getSetting('general')
    if (!settings) {
      console.warn('[EndgeSSE] settings:general not found')
      // console.groupEnd()
      return
    }

    const cfg: SettingsSSESchema | undefined = settings.sse
    if (!cfg?.url) {
      console.warn('[EndgeSSE] settings.sse.url is empty')
      // console.groupEnd()
      return
    }

    const url: string = String(Endge.vars.resolve(cfg.url) ?? cfg.url).trim()
    if (!url) {
      console.warn('[EndgeSSE] resolved sse url is empty')
      // console.groupEnd()
      return
    }

    // console.log('[EndgeSSE] url:', url)
    // console.log('[EndgeSSE] sse cfg:', cfg)

    this.stopSSE()
    await this.refreshTokenCached(cfg)

    this._sseManager = new SSEManager({
      url,
      retryInterval: 5000,

      // ВАЖНО: сюда отдаём ТОЛЬКО токен (без "Bearer ")
      getToken: (): string | undefined => {
        return this._tokenCached
      },

      onEvent: (message: unknown): void => {
        this.emitCustomSSEEvent(message)
      },
    })

    this._sseManager.start()
    // console.log('[EndgeSSE] started')

    this.startTokenRefreshTimer(cfg)

    console.groupEnd()
  }

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

  public stopSSE(): void {
    // console.log('[EndgeSSE] stopSSE')

    if (this._tokenRefreshTimer) {
      clearInterval(this._tokenRefreshTimer)
      this._tokenRefreshTimer = null
    }

    if (this._sseManager) {
      this._sseManager.stop()
      this._sseManager = null
    }

    this._tokenCached = undefined
  }

  public toggleSSE(): void {
    if (this.isSSEActive) {
      this.stopSSE()
    }
    else {
      void this.startSSE()
    }
  }

  public get sseRate(): number {
    if (!this._sseManager)
      return 0
    return this._upsMeter.rate
  }

  public get isSSEActive(): boolean {
    return this._sseManager !== null && this._sseManager.isConnected
  }

  private startTokenRefreshTimer(cfg: SettingsSSESchema): void {
    if (this._tokenRefreshTimer)
      return

    this._tokenRefreshTimer = setInterval((): void => {
      void this.refreshTokenCached(cfg)
    }, 30_000)
  }

  private async refreshTokenCached(cfg: SettingsSSESchema): Promise<void> {
    const mode: SettingsSSEAuthMode = cfg.authMode ?? 'inherit'

    // console.group('[EndgeSSE] refreshTokenCached')
    // console.log('authMode:', mode)

    const prevToken: string | undefined = this._tokenCached

    try {
      const token: string | undefined
        = mode === 'none'
          ? undefined
          : mode === 'manual'
            ? await Endge.auth.getAccessToken({
                mode: 'manual',
                manualToken: cfg.manualToken ?? '',
              })
            : await Endge.auth.getAccessToken({ mode: 'inherit' })

      this._tokenCached = token

      // console.log('tokenCached:', token ? `${token.slice(0, 12)}...` : '<none>')

      // Если токен появился/сменился - делаем reconnect (иначе SSE может сидеть в 401 до retry)
      if (this._sseManager && prevToken !== token) {
        console.log('[EndgeSSE] token changed -> reconnect')
        this._sseManager.stop()
        this._sseManager.start()
      }
    }
    catch (e) {
      console.warn('[EndgeSSE] token refresh failed:', e)
    }
    finally {
      console.groupEnd()
    }
  }
}
