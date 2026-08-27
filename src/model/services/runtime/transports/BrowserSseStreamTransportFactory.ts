import type {
  StreamTransportConnection,
  StreamTransportFactory,
  StreamTransportMessage,
} from '@/domain/types/runtime/stream-runtime.types'

import { SSEManager } from '@endge/utils'

import { Endge } from '@/model/kernel/endge'

/** Browser adapter that owns native EventSource and converts it to a Core transport port. */
export class BrowserSseStreamTransportFactory implements StreamTransportFactory {
  public open(artifact: Parameters<StreamTransportFactory['open']>[0], callbacks: Parameters<StreamTransportFactory['open']>[1]): StreamTransportConnection {
    if (artifact.transport.kind !== 'sse') {
      throw new Error(`Unsupported Stream transport: ${(artifact.transport as any).kind}`)
    }
    if (artifact.transport.authMode !== 'none') {
      if (artifact.events.some(event => event.sourceEvent !== 'message')) {
        throw new Error('Authenticated SSE transport supports only the default "message" event.')
      }
      let forceRefreshOnReconnect = false
      const manager = new SSEManager({
        url: artifact.transport.url,
        retryInterval: 5000,
        getToken: async () => {
          const profileIdentity = String(artifact.transport.authProfileIdentity ?? '').trim()
          if (artifact.transport.authMode === 'profile' && !profileIdentity) {
            throw new Error('[BrowserSseStreamTransportFactory] Auth profile is required for profile mode.')
          }
          const session = await Endge.auth.requests.resolve(
            artifact.transport.authMode === 'profile'
              ? { mode: 'profile', profile: profileIdentity }
              : { mode: 'inherit' },
            { forceRefresh: forceRefreshOnReconnect },
          )
          forceRefreshOnReconnect = false
          const token = String(session.accessToken ?? '').trim()
          if (!token) {
            throw new Error(`[BrowserSseStreamTransportFactory] Auth profile "${session.profileIdentity ?? profileIdentity}" did not provide an access token.`)
          }
          return token
        },
        onOpen: callbacks.open,
        onError: (error) => {
          if (isUnauthorizedSseError(error)) {
            forceRefreshOnReconnect = true
          }
          callbacks.error(error)
        },
        onEvent: data => callbacks.message({
          sourceEvent: 'message',
          id: null,
          data,
        }),
      })
      manager.start()
      return { close: () => manager.stop() }
    }
    if (typeof EventSource === 'undefined') {
      throw new Error('EventSource is unavailable in the current runtime.')
    }

    const source = new EventSource(artifact.transport.url, {
      withCredentials: artifact.transport.withCredentials,
    })
    const listeners: Array<{ name: string, listener: EventListener }> = []
    const forward = (sourceEvent: string, raw: MessageEvent) => {
      const message: StreamTransportMessage = {
        sourceEvent,
        id: raw.lastEventId || null,
        data: parseEventData(raw.data),
      }
      callbacks.message(message)
    }

    for (const event of artifact.events) {
      const listener: EventListener = raw => forward(event.sourceEvent, raw as MessageEvent)
      source.addEventListener(event.sourceEvent, listener)
      listeners.push({ name: event.sourceEvent, listener })
    }
    source.onopen = () => callbacks.open()
    source.onerror = error => callbacks.error(error)

    return {
      close: () => {
        for (const item of listeners) {
          source.removeEventListener(item.name, item.listener)
        }
        source.close()
      },
    }
  }
}

function isUnauthorizedSseError(error: unknown): boolean {
  return /unexpected response:\s*(?:401|403)\b/i.test(String((error as Error | undefined)?.message ?? error))
}

function parseEventData(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value
  }
  try {
    return JSON.parse(value)
  }
  catch {
    return value
  }
}
