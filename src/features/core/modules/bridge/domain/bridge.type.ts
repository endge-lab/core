/** Локальная политика host, не сохраняемая в Domain. URL включает backend base path. */
export type EndgeBridgeBootOptions
  = | { role: 'client', allowedServers: readonly string[], debug?: boolean, label?: string }
    | { role: 'configurator', serverUrl: string, debug?: boolean, label?: string }

export interface BridgeConnectionState {
  serverUrl: string
  status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  instanceId?: string
  error?: string
}

export interface ConfiguratorConnection {
  serverUrl: string
  instanceId: string
  userId: string
  displayName: string
  label: string
}

export interface ConfiguratorParticipant {
  serverUrl: string
  userId: string
  displayName: string
  connectionCount: number
}

export interface BridgeDebugClient {
  serverUrl: string
  instanceId: string
  label: string
}

export interface BridgeDebugSession {
  serverUrl: string
  sessionId: string
  clientId: string
  configuratorId: string
}

export interface DebugConnectionRequest {
  serverUrl: string
  sessionId: string
  workspaceIdentity: string
  displayName: string
  expiresAt: number
}

export type SimulationRunResult
  = | { status: 'mocked', identity: string, hash: string }
    | { status: 'rejected', reason: 'not-found' | 'hash-mismatch' }

/** Закрытый набор сообщений bridge v1; это не произвольный RPC над Core. */
export interface BridgeMessage {
  type: string
  id?: string
  sessionId?: string
  targetId?: string
  identity?: string
  expectedHash?: string
  accepted?: boolean
  data?: unknown
  error?: string
}

/** Внутренний порт подмодулей к единственному владельцу соединений. */
export interface BridgeCommands {
  request: (serverUrl: string, message: BridgeMessage) => Promise<unknown>
  send: (serverUrl: string, message: BridgeMessage) => void
}
