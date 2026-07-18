// @vitest-environment node
import {
  createEndgeAuthContext,
  decodeJwtClaims,
} from '@/model/services/auth/auth-context'
import { describe, expect, it } from 'vitest'

/** Создаёт неподписанный JWT только для проверки безопасного payload decoding. */
function createToken(payload: Record<string, unknown>): string {
  const encoded = globalThis.btoa(JSON.stringify(payload))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
  return `header.${encoded}.signature`
}

describe('Endge auth context', () => {
  it('extracts stable subject and session id without exposing full claims', () => {
    const accessToken = createToken({
      sub: 'user-from-access',
      sid: 'session-from-access',
      email: 'private@example.test',
    })
    const idToken = createToken({ sub: 'user-from-id-token' })

    expect(createEndgeAuthContext({
      authenticated: true,
      accessToken,
      idToken,
      profileIdentity: 'keycloak-main',
    })).toEqual({
      authenticated: true,
      subject: 'user-from-id-token',
      sessionId: 'session-from-access',
      profileIdentity: 'keycloak-main',
    })
  })

  it('prefers userinfo subject and accepts Keycloak session_state fallback', () => {
    expect(createEndgeAuthContext({
      authenticated: true,
      accessToken: createToken({ sub: 'token-user' }),
      sessionState: 'keycloak-session',
      userInfo: { sub: 'userinfo-user', name: 'Private Name' },
    })).toEqual({
      authenticated: true,
      subject: 'userinfo-user',
      sessionId: 'keycloak-session',
    })
  })

  it('returns anonymous context for inactive auth and ignores malformed JWT', () => {
    expect(createEndgeAuthContext({
      authenticated: false,
      accessToken: createToken({ sub: 'must-not-leak' }),
    })).toEqual({ authenticated: false })
    expect(decodeJwtClaims('not-a-jwt')).toBeNull()
  })
})
