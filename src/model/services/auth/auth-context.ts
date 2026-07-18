import type { EndgeAuthContext } from '@/domain/types/auth/auth-profile.types'

/** Минимальные источники, из которых можно построить безопасный auth context. */
export interface EndgeAuthContextSource {
  authenticated: boolean
  accessToken?: string
  idToken?: string
  sessionState?: string
  profileIdentity?: string
  userInfo?: unknown
}

/** Декодирует только JWT payload; результат не используется для authorization decisions. */
export function decodeJwtClaims(token: string | null | undefined): Record<string, unknown> | null {
  const payload = String(token ?? '').split('.')[1]
  if (!payload)
    return null

  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const binary = globalThis.atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    return isRecord(parsed) ? parsed : null
  }
  catch {
    return null
  }
}

/** Строит минимальный actor/session snapshot без сохранения tokens или полного claims. */
export function createEndgeAuthContext(source: EndgeAuthContextSource): EndgeAuthContext {
  if (!source.authenticated)
    return { authenticated: false }

  const idClaims = decodeJwtClaims(source.idToken)
  const accessClaims = decodeJwtClaims(source.accessToken)
  const userInfo = isRecord(source.userInfo) ? source.userInfo : null
  const subject = firstText(userInfo?.sub, idClaims?.sub, accessClaims?.sub)
  const sessionId = firstText(
    idClaims?.sid,
    accessClaims?.sid,
    idClaims?.session_state,
    accessClaims?.session_state,
    source.sessionState,
  )
  const profileIdentity = firstText(source.profileIdentity)

  return {
    authenticated: true,
    ...(subject ? { subject } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(profileIdentity ? { profileIdentity } : {}),
  }
}

/** Возвращает первую непустую строку из списка claim candidates. */
function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized)
      return normalized
  }
  return undefined
}

/** Проверяет plain object перед чтением claims. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
