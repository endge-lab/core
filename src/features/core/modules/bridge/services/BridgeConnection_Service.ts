import type { BrowserBridge_Adapter } from '@/features/core/modules/bridge/adapters/BrowserBridge_Adapter'
import type { BridgeConnectionState, BridgeMessage } from '@/features/core/modules/bridge/domain/bridge.type'
import { BRIDGE_CONFIG } from '@/features/core/modules/bridge/config/bridge.config'

/** Один socket generation, bounded requests и reconnect одного backend. */
export class BridgeConnection_Service {
  private _socket: WebSocket | null = null
  private _retry: ReturnType<typeof setTimeout> | null = null
  private _registration: ReturnType<typeof setTimeout> | null = null
  private _watchdog: ReturnType<typeof setTimeout> | null = null
  private _attempt = 0
  private _active = false
  private _ready = false
  private readonly _pending = new Map<string, { resolve: (value: unknown) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout> }>()

  public constructor(
    private readonly _serverUrl: string,
    private readonly _role: 'client' | 'configurator',
    private readonly _hello: unknown,
    private readonly _adapter: BrowserBridge_Adapter,
    private readonly _onState: (state: BridgeConnectionState) => void,
    private readonly _onMessage: (message: BridgeMessage) => void,
  ) {}

  /** Запускает одну попытку. Повторный вызов не создаёт второй socket. */
  public start(): void {
    if (this._active) {
      return
    }
    this._active = true
    this._open()
  }

  /** Отменяет всю работу; запоздалые callbacks старого socket игнорируются. */
  public stop(): void {
    this._active = false
    if (this._retry) {
      clearTimeout(this._retry)
    }
    this._retry = null
    this._disposeSocket()
    this._onState({ serverUrl: this._serverUrl, status: 'disconnected' })
  }

  /** Отправляет конечную команду с correlation id и deadline. */
  public request(message: BridgeMessage): Promise<unknown> {
    if (!this._ready || this._pending.size >= BRIDGE_CONFIG.maxPendingRequests) {
      return Promise.reject(new Error('[Endge Bridge] Connection is unavailable or request limit reached'))
    }
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(id)
        reject(new Error('[Endge Bridge] Request timed out'))
      }, BRIDGE_CONFIG.requestTimeoutMs)
      this._pending.set(id, { resolve, reject, timer })
      try {
        this.send({ ...message, id })
      }
      catch (error) {
        clearTimeout(timer)
        this._pending.delete(id)
        reject(error)
      }
    })
  }

  /** Отправляет сообщение без очереди для offline-соединения. */
  public send(message: BridgeMessage): void {
    const socket = this._socket
    if (!this._ready || !socket || socket.readyState !== 1) {
      throw new Error('[Endge Bridge] Connection is not ready')
    }
    const json = JSON.stringify(message)
    if (new TextEncoder().encode(json).byteLength > BRIDGE_CONFIG.maxMessageBytes) {
      throw new Error('[Endge Bridge] Message exceeds 16 MiB; snapshot was not truncated')
    }
    if (socket.bufferedAmount > BRIDGE_CONFIG.maxMessageBytes) {
      this.stop()
      throw new Error('[Endge Bridge] Send buffer limit reached')
    }
    socket.send(json)
  }

  private _open(): void {
    this._onState({ serverUrl: this._serverUrl, status: this._attempt ? 'reconnecting' : 'connecting' })
    try {
      const url = new URL(`${this._serverUrl}/api/v1/bridge/${this._role}`)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = this._adapter.open(url.toString())
      this._socket = socket
      this._registration = setTimeout(() => {
        if (this._socket === socket) {
          this._closed('Registration timed out')
        }
      }, BRIDGE_CONFIG.registrationTimeoutMs)
      socket.onopen = () => {
        if (this._socket === socket) {
          socket.send(JSON.stringify({ type: 'hello', data: this._hello }))
        }
      }
      socket.onmessage = (event) => {
        if (this._socket !== socket) {
          return
        }
        try {
          if (typeof event.data !== 'string' || event.data.length > BRIDGE_CONFIG.maxMessageBytes) {
            throw new Error('Invalid bridge message')
          }
          const message = JSON.parse(event.data) as BridgeMessage
          if (!message || typeof message.type !== 'string') {
            throw new Error('Invalid bridge envelope')
          }
          if (!this._ready && message.type !== 'welcome') {
            throw new Error('Bridge welcome is required')
          }
          if (this._watchdog) {
            clearTimeout(this._watchdog)
          }
          this._watchdog = setTimeout(() => {
            if (this._socket === socket) {
              this._closed('Server heartbeat timed out')
            }
          }, BRIDGE_CONFIG.serverSilenceTimeoutMs)
          if (message.type === 'welcome') {
            const welcome = message.data as { instanceId: string, protocol: number }
            if (this._ready || welcome?.protocol !== BRIDGE_CONFIG.protocol || typeof welcome.instanceId !== 'string') {
              throw new Error('Incompatible bridge protocol')
            }
            this._ready = true
            this._attempt = 0
            if (this._registration) {
              clearTimeout(this._registration)
            }
            this._registration = null
            this._onState({ serverUrl: this._serverUrl, status: 'connected', instanceId: welcome.instanceId })
          }
          if (message.type === 'result' && message.id) {
            const pending = this._pending.get(message.id)
            if (pending) {
              this._pending.delete(message.id)
              clearTimeout(pending.timer)
              if (message.error) {
                pending.reject(new Error(`[Endge Bridge] ${message.error}`))
              }
              else {
                pending.resolve(message.data)
              }
            }
            return
          }
          this._onMessage(message)
        }
        catch {
          this._closed('Invalid server message', false)
        }
      }
      socket.onclose = (event) => {
        if (this._socket === socket) {
          this._closed('Connection closed', event.code !== 1008)
        }
      }
      socket.onerror = () => {
        if (this._socket === socket) {
          this._closed('Connection failed')
        }
      }
    }
    catch {
      this._closed('Connection unavailable')
    }
  }

  private _closed(error: string, retry = true): void {
    this._disposeSocket()
    const reconnect = this._active && retry
    this._onState({ serverUrl: this._serverUrl, status: reconnect ? 'reconnecting' : 'disconnected', error })
    if (!reconnect) {
      this._active = false
      return
    }
    const delay = Math.min(1000 * 2 ** Math.min(this._attempt++, 5), BRIDGE_CONFIG.reconnectMaxMs)
    this._retry = setTimeout(() => {
      this._retry = null
      if (this._active) {
        this._open()
      }
    }, delay * (0.8 + Math.random() * 0.2))
  }

  private _disposeSocket(): void {
    this._ready = false
    if (this._watchdog) {
      clearTimeout(this._watchdog)
    }
    this._watchdog = null
    if (this._registration) {
      clearTimeout(this._registration)
    }
    this._registration = null
    const socket = this._socket
    this._socket = null
    if (socket) {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
      socket.close()
    }
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('[Endge Bridge] Connection closed'))
    }
    this._pending.clear()
  }
}
