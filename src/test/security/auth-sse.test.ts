import type { AuthResolvedSession } from '@/domain/types/auth/auth-profile.types'

import { afterEach, describe, expect, it, vi } from 'vitest'

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

import { Endge } from '@/model/kernel/endge'
import { compileStreamSource } from '@/model/services/source-engine/compilers/stream-source-compile'
import { BrowserSseStreamTransportFactory } from '@/model/services/runtime/transports/BrowserSseStreamTransportFactory'

describe('authenticated SSE transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    sse.options = null
  })

  it('forces one refresh on reconnect after 401/403 without a background timer', async () => {
    const resolved: AuthResolvedSession = {
      profileIdentity: 'application-auth',
      accessToken: 'token',
      headers: { Authorization: 'Bearer token' },
      expiresAt: null,
    }
    const resolve = vi.spyOn(Endge.auth.requests, 'resolve').mockResolvedValue(resolved)
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    new BrowserSseStreamTransportFactory().open({
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

  it('resolves the named profile authored in Stream source', async () => {
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

    const resolve = vi.spyOn(Endge.auth.requests, 'resolve').mockResolvedValue({
      profileIdentity: 'keycloak-local',
      accessToken: 'profile-token',
      headers: { Authorization: 'Bearer profile-token' },
      expiresAt: null,
    })
    new BrowserSseStreamTransportFactory().open(compiled.artifact!, {
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
})
