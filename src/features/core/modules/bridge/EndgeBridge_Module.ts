import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { BridgeConnectionState, BridgeMessage, ConfiguratorConnection, EndgeBridgeBootOptions } from '@/features/core/modules/bridge/domain/bridge.type'
import { BrowserBridge_Adapter } from '@/features/core/modules/bridge/adapters/BrowserBridge_Adapter'
import { BRIDGE_CONFIG, normalizeBridgeServer } from '@/features/core/modules/bridge/config/bridge.config'
import { EndgeBridgeConfigurator_Module } from '@/features/core/modules/bridge/configurator/EndgeBridgeConfigurator_Module'
import { EndgeBridgeDebug_Module } from '@/features/core/modules/bridge/debug/EndgeBridgeDebug_Module'
import { BridgeConnection_Service } from '@/features/core/modules/bridge/services/BridgeConnection_Service'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Владелец bridge транспорта, host policy и lifecycle обоих подмодулей. */
export class EndgeBridge_Module extends EndgeModule<EndgeBootContext> {
  public readonly debug: EndgeBridgeDebug_Module
  public readonly configurator = new EndgeBridgeConfigurator_Module()
  private _options: EndgeBridgeBootOptions | undefined
  private _workspaceIdentity = ''
  private _started = false
  private _suspended = false
  private _unsubscribePage: (() => void) | null = null
  private readonly _allowed = new Set<string>()
  private readonly _connections = new Map<string, BridgeConnection_Service>()
  private readonly _states = new Map<string, BridgeConnectionState>()

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  /** Создаёт owner и его явные зависимости без запуска транспорта. */
  public constructor(private readonly _adapter = new BrowserBridge_Adapter()) {
    super()
    this.debug = new EndgeBridgeDebug_Module({
      request: (serverUrl, message) => this._connection(serverUrl).request(message),
      send: (serverUrl, message) => this._connection(serverUrl).send(message),
    }, _adapter)
  }

  /** Принимает optional host policy без network/DOM side effects. */
  public override setup(ctx: EndgeBootContext): void {
    this._options = ctx.bridge ? { ...ctx.bridge } : undefined
    this._workspaceIdentity = ctx.scope.workspaceIdentity ?? ''
    this._allowed.clear()
    if (!this._options) {
      return
    }
    const servers = this._options.role === 'client' ? this._options.allowedServers : [this._options.serverUrl]
    for (const server of servers) {
      this._allowed.add(normalizeBridgeServer(server))
    }
    if (this._allowed.size && !this._workspaceIdentity) {
      throw new Error('[Endge Bridge] scope.workspaceIdentity is required')
    }
    this.debug.configure(this._options.role, this._options.debug === true)
  }

  /** Запускает live transports после загрузки Domain и diagnostics. */
  public override start(): void {
    if (this._started || !this._options || !this._allowed.size) {
      return
    }
    this._started = true
    this._unsubscribePage = this._adapter.subscribePage(() => {
      this._suspended = true
      for (const connection of this._connections.values()) {
        connection.stop()
      }
    }, () => {
      if (this._started && this._suspended) {
        this._suspended = false
        for (const connection of this._connections.values()) {
          connection.start()
        }
      }
    })
    for (const serverUrl of this._allowed) {
      this.connect(serverUrl)
    }
  }

  /** Подключается только к адресу из неизменяемой host policy текущего boot. */
  public connect(rawServerUrl: string): void {
    const serverUrl = normalizeBridgeServer(rawServerUrl)
    if (!this._started || !this._options || !this._allowed.has(serverUrl)) {
      throw new Error('[Endge Bridge] Server is not allowed or module is not started')
    }
    let connection = this._connections.get(serverUrl)
    if (!connection) {
      connection = new BridgeConnection_Service(serverUrl, this._options.role, {
        protocol: BRIDGE_CONFIG.protocol,
        workspaceIdentity: this._workspaceIdentity,
        debug: this._options.debug === true,
        label: this._options.label ?? this._options.role,
      }, this._adapter, (state) => {
        this._states.set(serverUrl, state)
        if (state.status !== 'connected') {
          this.debug.disconnect(serverUrl)
          this.configurator.disconnect(serverUrl)
        }
        this.notify()
      }, message => this._receive(serverUrl, message))
      this._connections.set(serverUrl, connection)
    }
    if (!this._suspended) {
      connection.start()
    }
  }

  /** Отключение пользователем прекращает reconnect до следующего connect/boot. */
  public disconnect(rawServerUrl: string): void {
    const serverUrl = normalizeBridgeServer(rawServerUrl)
    this._connections.get(serverUrl)?.stop()
    this._connections.delete(serverUrl)
  }

  /** Отзывает текущий lifecycle и освобождает принадлежащее модулю состояние. */
  public override reset(): void {
    this._started = false
    this._suspended = false
    this._unsubscribePage?.()
    this._unsubscribePage = null
    for (const connection of this._connections.values()) {
      connection.stop()
    }
    this._connections.clear()
    this.debug.reset()
    this.configurator.reset()
    this._states.clear()
    this._allowed.clear()
    this._options = undefined
    this._workspaceIdentity = ''
    this.notify()
  }

  /** Только безопасные metadata; без pending payloads и снимков других клиентов. */
  public override createDiagnosticsSnapshot(): unknown {
    return { connections: this.connections, sessions: this.debug.sessions, configurators: this.configurator.connections }
  }

  /**
   * ----------------------------------------
   * PRIVATE
   * ----------------------------------------
   */

  /** Разрешает только существующее соединение из host allowlist. */
  private _connection(rawServerUrl: string): BridgeConnection_Service {
    const connection = this._connections.get(normalizeBridgeServer(rawServerUrl))
    if (!connection) {
      throw new Error('[Endge Bridge] Server is disconnected')
    }
    return connection
  }

  /** Направляет сообщение в подмодуль и отзывает канал при ошибке обработки. */
  private _receive(serverUrl: string, message: BridgeMessage): void {
    if (message.type === 'configurators') {
      this.configurator.update(serverUrl, message.data as Omit<ConfiguratorConnection, 'serverUrl'>[])
      this.notify()
      return
    }
    void this.debug.receive(serverUrl, message).catch(() => {
      // Ошибка обработки отозванного/недоступного канала не сохраняет его согласие.
      this.disconnect(serverUrl)
    })
  }

  /**
   * ----------------------------------------
   * ACCESS
   * ----------------------------------------
   */

  /** Возвращает текущие подключения без доступа к внутреннему mutable state. */
  public get connections(): readonly BridgeConnectionState[] {
    return Array.from(this._states.values(), value => ({ ...value }))
  }
}
