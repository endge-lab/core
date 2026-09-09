/** Ограничения протокола и ресурсов bridge v1. */
export const BRIDGE_CONFIG = {
  protocol: 1,
  registrationTimeoutMs: 10_000,
  serverSilenceTimeoutMs: 75_000,
  requestTimeoutMs: 60_000,
  reconnectMaxMs: 30_000,
  maxMessageBytes: 16 * 1024 * 1024,
  maxPendingRequests: 16,
} as const

/** Нормализует точный backend URL без credentials, query и fragment. */
export function normalizeBridgeServer(raw: string): string {
  const url = new URL(raw.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('[Endge Bridge] Expected an HTTP(S) backend URL without credentials, query or fragment')
  }
  return url.toString().replace(/\/+$/, '')
}

/** Разбирает CSV environment value на стороне host до передачи массива в boot. */
export function parseBridgeAllowedServers(value: string | undefined): string[] {
  return [...new Set((value ?? '').split(',').map(item => item.trim()).filter(Boolean).map(normalizeBridgeServer))]
}
