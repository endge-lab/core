import type { AuthResolvedSession } from '@/features/core/modules/auth/domain/types/auth-profile.types'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { BrowserSseStreamTransportFactory } from '@/features/core/modules/runtime/services/transports/BrowserSseStreamTransportFactory'
import { compileStreamSource } from '@/features/core/modules/source/services/compilers/stream-source-compile'

const sse = vi.hoisted(() => ({ options: null as Record<string, any> | null }))

vi.mock('@endge/utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('@endge/utils')>()
  return {
    ...original,
    SSEManager: class FakeSSEManager {
      public constructor(options: Record<string, any>) {
        sse.options = options
      }

      public start(): void {}
      public stop(): void {}
    },
  }
})

describe('авторизованный транспорт SSE', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sse.options = null
  })

  it('принудительно выполняет одно обновление при переподключении после 401/403 без фонового таймера', async () => {
    const resolved: AuthResolvedSession = {
      profileIdentity: 'application-auth',
      accessToken: 'token',
      headers: { Authorization: 'Bearer token' },
      expiresAt: null,
    }
    const resolve = vi.fn().mockResolvedValue(resolved)
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    new BrowserSseStreamTransportFactory(resolve).open({
      type: 'stream',
      sourceVersion: 1,
      transport: {
        kind: 'sse',
        url: '/events',
        withCredentials: false,
        authMode: 'inherit',
        authProfileIdentity: null,
      },
      events: [{ sourceEvent: 'message', type: null, typePath: null, payloadPath: null }],
    }, {
      message: vi.fn(),
      error: vi.fn(),
      open: vi.fn(),
    })

    expect(await sse.options?.getToken()).toBe('token')
    expect(resolve).toHaveBeenLastCalledWith({ mode: 'inherit' }, { forceRefresh: false })
    sse.options?.onError(new Error('Unexpected response: 401'))
    expect(await sse.options?.getToken()).toBe('token')
    expect(resolve).toHaveBeenLastCalledWith({ mode: 'inherit' }, { forceRefresh: true })
    expect(setIntervalSpy).not.toHaveBeenCalled()
  })

  it('разрешает именованный профиль, заданный в Source Stream', async () => {
    const compiled = compileStreamSource(`defineStream({
      transport: sse({
        url: '/events',
        auth: {
          mode: 'profile',
          profile: 'keycloak-local',
        },
      }),
      events: {
        message: event('schedule.updated'),
      },
    })`)
    expect(compiled.diagnostics).toEqual([])
    expect(compiled.artifact?.transport).toMatchObject({
      authMode: 'profile',
      authProfileIdentity: 'keycloak-local',
    })

    const resolve = vi.fn().mockResolvedValue({
      profileIdentity: 'keycloak-local',
      accessToken: 'profile-token',
      headers: { Authorization: 'Bearer profile-token' },
      expiresAt: null,
    })
    new BrowserSseStreamTransportFactory(resolve).open(compiled.artifact!, {
      message: vi.fn(),
      error: vi.fn(),
      open: vi.fn(),
    })

    expect(await sse.options?.getToken()).toBe('profile-token')
    expect(resolve).toHaveBeenCalledWith(
      { mode: 'profile', profile: 'keycloak-local' },
      { forceRefresh: false },
    )
  })

  it('сохраняет имена событий авторизованного SSE вместо сведения к message', () => {
    const compiled = compileStreamSource(`defineStream({
      transport: sse({ url: '/events', withCredentials: true, auth: 'inherit' }),
      events: {
        snapshot: event('orders.snapshot'),
        message: event('orders.changed'),
      },
    })`)
    expect(compiled.diagnostics).toEqual([])
    const callbacks = { message: vi.fn(), error: vi.fn(), open: vi.fn() }
    new BrowserSseStreamTransportFactory(vi.fn()).open(compiled.artifact!, callbacks)

    expect(sse.options?.withCredentials).toBe(true)
    expect(sse.options?.onEvent).toBeUndefined()
    sse.options?.onMessage({ event: 'snapshot', id: '42', data: { items: [] } })
    sse.options?.onMessage({ event: 'message', id: null, data: 'plain' })
    expect(callbacks.message.mock.calls.map(([message]) => message)).toEqual([
      { sourceEvent: 'snapshot', id: '42', data: { items: [] } },
      { sourceEvent: 'message', id: null, data: 'plain' },
    ])
  })
})
