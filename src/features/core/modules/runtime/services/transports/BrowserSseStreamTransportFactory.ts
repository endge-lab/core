import type { AuthRequestPolicy, AuthResolvedSession, AuthResolveOptions } from '@/features/core/modules/auth/domain/types/auth-profile.types'
import type {
  StreamTransportConnection,
  StreamTransportFactory,
  StreamTransportMessage,
} from '@/features/core/modules/runtime/domain/stream-runtime.types'

import { SSEManager } from '@endge/utils'

export type ResolveAuthSession = (
  policy: AuthRequestPolicy,
  options?: AuthResolveOptions,
) => Promise<AuthResolvedSession>

/** Браузерный адаптер, владеющий нативным EventSource и преобразующий его в транспортный порт Core. */
export class BrowserSseStreamTransportFactory implements StreamTransportFactory {
  public constructor(private readonly _resolveAuthSession: ResolveAuthSession) {}

  public open(artifact: Parameters<StreamTransportFactory['open']>[0], callbacks: Parameters<StreamTransportFactory['open']>[1]): StreamTransportConnection {
    const transport = artifact.transport
    if (transport.kind !== 'sse') {
      throw new Error(`Unsupported Stream transport: ${(transport as any).kind}`)
    }
    if (transport.authMode !== 'none') {
      if (artifact.events.some(event => event.sourceEvent !== 'message')) {
        throw new Error('Authenticated SSE transport supports only the default "message" event.')
      }
      let forceRefreshOnReconnect = false
      const manager = new SSEManager({
        url: transport.url,
        retryInterval: 5000,
        getToken: async () => {
          const profileIdentity = String(transport.authProfileIdentity ?? '').trim()
          if (transport.authMode === 'profile' && !profileIdentity) {
            throw new Error('[BrowserSseStreamTransportFactory] Auth profile is required for profile mode.')
          }
          const session = await this._resolveAuthSession(
            transport.authMode === 'profile'
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

    const source = new EventSource(transport.url, {
      withCredentials: transport.withCredentials,
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
