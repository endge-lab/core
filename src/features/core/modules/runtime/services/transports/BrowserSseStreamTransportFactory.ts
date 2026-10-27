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

/**
 * Браузерный адаптер SSE: без авторизации владеет нативным EventSource, с авторизацией —
 * fetch-соединением SSEManager с Bearer token; оба сохраняют имена событий.
 */
export class BrowserSseStreamTransportFactory implements StreamTransportFactory {
  public constructor(private readonly _resolveAuthSession: ResolveAuthSession) {}

  public open(artifact: Parameters<StreamTransportFactory['open']>[0], callbacks: Parameters<StreamTransportFactory['open']>[1]): StreamTransportConnection {
    const transport = artifact.transport
    if (transport.kind !== 'sse') {
      throw new Error(`Unsupported Stream transport: ${(transport as any).kind}`)
    }
    if (transport.authMode !== 'none') {
      const token = createSseAuthTokenProvider(this._resolveAuthSession, transport)
      const manager = new SSEManager({
        url: transport.url,
        retryInterval: 5000,
        withCredentials: transport.withCredentials,
        getToken: token.getToken,
        onOpen: callbacks.open,
        onError: (error) => {
          token.onError(error)
          callbacks.error(error)
        },
        // Имя события сохраняется: events Source может объявлять не только message.
        onMessage: message => callbacks.message({
          sourceEvent: message.event,
          id: message.id,
          data: message.data,
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

/**
 * Получает access token AuthProfile для SSE-запроса; после 401/403 следующий запрос
 * принудительно обновляет сессию.
 */
export function createSseAuthTokenProvider(
  resolveAuthSession: ResolveAuthSession,
  transport: { authMode: 'inherit' | 'profile' | 'none', authProfileIdentity: string | null },
): { getToken: () => Promise<string>, onError: (error: unknown) => void } {
  let forceRefreshOnReconnect = false
  return {
    getToken: async () => {
      const profileIdentity = String(transport.authProfileIdentity ?? '').trim()
      if (transport.authMode === 'profile' && !profileIdentity) {
        throw new Error('[BrowserSseStreamTransportFactory] Auth profile is required for profile mode.')
      }
      const session = await resolveAuthSession(
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
    onError: (error) => {
      if (isUnauthorizedSseError(error)) {
        forceRefreshOnReconnect = true
      }
    },
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
