import type { StreamTransportConnection, StreamTransportFactory } from '@/features/core/modules/runtime/domain/stream-runtime.types'

/** Владеет WebSocket, повторной подпиской и таймером переподключения одного Stream. */
export class BrowserWebSocketStreamTransportFactory implements StreamTransportFactory {
  /** Открывает JSON transport; close отменяет reconnect и все callbacks соединения. */
  public open(artifact: Parameters<StreamTransportFactory['open']>[0], callbacks: Parameters<StreamTransportFactory['open']>[1]): StreamTransportConnection {
    const transport = artifact.transport
    if (transport.kind !== 'websocket') {
      throw new Error(`Unsupported Stream transport: ${transport.kind}`)
    }
    if (typeof WebSocket === 'undefined') {
      throw new TypeError('WebSocket is unavailable in the current runtime.')
    }
    if (!['ws:', 'wss:'].includes(new URL(transport.url).protocol)) {
      throw new Error('WebSocket Stream requires a ws:// or wss:// URL.')
    }
    const messages = transport.onOpen.map(message => JSON.stringify(message))
    let closed = false
    let socket: WebSocket | null = null
    let disposeSocket = () => {}
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectDelay = 1000

    const scheduleReconnect = () => {
      if (closed || reconnectTimer !== null) {
        return
      }
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        connect()
      }, reconnectDelay)
      reconnectDelay = Math.min(reconnectDelay * 2, 15000)
    }

    function connect() {
      if (closed) {
        return
      }
      let current: WebSocket
      try {
        current = new WebSocket(transport.url)
      }
      catch (error) {
        callbacks.error(error)
        scheduleReconnect()
        return
      }
      socket = current
      const isCurrent = () => !closed && socket === current
      const onOpen = () => {
        if (!isCurrent()) {
          return
        }
        try {
          for (const message of messages) {
            current.send(message)
          }
        }
        catch (error) {
          callbacks.error(error)
          current.close()
          return
        }
        callbacks.open()
      }
      const onMessage = (event: MessageEvent) => {
        if (!isCurrent()) {
          return
        }
        let data: unknown
        try {
          if (typeof event.data !== 'string') {
            throw new TypeError('WebSocket Stream supports JSON text messages only.')
          }
          data = JSON.parse(event.data)
        }
        catch (error) {
          callbacks.error(error)
          return
        }
        reconnectDelay = 1000
        callbacks.message({ sourceEvent: 'message', id: null, data })
      }
      const onError = () => {
        if (isCurrent()) {
          callbacks.error(new Error('WebSocket Stream connection failed.'))
        }
      }
      const onClose = (event: CloseEvent) => {
        if (!isCurrent()) {
          return
        }
        disposeSocket()
        socket = null
        callbacks.error(new Error(`WebSocket Stream closed (${event.code}).`))
        scheduleReconnect()
      }
      disposeSocket = () => {
        current.removeEventListener('open', onOpen)
        current.removeEventListener('message', onMessage)
        current.removeEventListener('error', onError)
        current.removeEventListener('close', onClose)
      }
      current.addEventListener('open', onOpen)
      current.addEventListener('message', onMessage)
      current.addEventListener('error', onError)
      current.addEventListener('close', onClose)
    }

    connect()
    return {
      close: () => {
        if (closed) {
          return
        }
        closed = true
        if (reconnectTimer !== null) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        disposeSocket()
        const current = socket
        socket = null
        current?.close()
      },
    }
  }
}
