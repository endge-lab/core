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
      transport: { kind: 'sse', url: '/events', withCredentials: false, authMode: 'inherit' },
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
})
