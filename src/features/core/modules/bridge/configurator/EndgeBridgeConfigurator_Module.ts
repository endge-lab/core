import type { ConfiguratorConnection, ConfiguratorParticipant } from '@/features/core/modules/bridge/domain/bridge.type'
import { EndgeModule } from '@/features/federation/EndgeModule'

/** Проекция авторизованных конфигураторов workspace, без page/UI state. */
export class EndgeBridgeConfigurator_Module extends EndgeModule {
  private readonly _byServer = new Map<string, readonly ConfiguratorConnection[]>()

  /**
   * ----------------------------------------
   * PUBLIC
   * ----------------------------------------
   */

  /** Родитель заменяет authoritative server roster целиком, включая пустой. */
  public update(serverUrl: string, connections: readonly Omit<ConfiguratorConnection, 'serverUrl'>[]): void {
    this._byServer.set(serverUrl, connections.map(value => ({ ...value, serverUrl })))
    this.notify()
  }

  /** Удаляет устаревшую проекцию при потере backend. */
  public disconnect(serverUrl: string): void {
    this._byServer.delete(serverUrl)
    this.notify()
  }

  /** Отзывает текущий lifecycle и освобождает принадлежащее модулю состояние. */
  public override reset(): void {
    this._byServer.clear()
    this.notify()
  }

  /**
   * ----------------------------------------
   * ACCESS
   * ----------------------------------------
   */

  /** Возвращает текущие подключения без доступа к внутреннему mutable state. */
  public get connections(): readonly ConfiguratorConnection[] {
    return Array.from(this._byServer.values()).flat().map(value => ({ ...value }))
  }

  /** Объединяет вкладки пользователя отдельно для каждого backend. */
  public get participants(): readonly ConfiguratorParticipant[] {
    const users = new Map<string, ConfiguratorParticipant>()
    for (const connection of this.connections) {
      const key = JSON.stringify([connection.serverUrl, connection.userId])
      const user = users.get(key)
      if (user) {
        user.connectionCount++
      }
      else {
        users.set(key, { serverUrl: connection.serverUrl, userId: connection.userId, displayName: connection.displayName, connectionCount: 1 })
      }
    }
    return Array.from(users.values())
  }
}
