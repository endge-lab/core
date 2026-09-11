import type { DiagnosticsSnapshotOptions } from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'

/** Ограничения протокола и ресурсов bridge v1. */
export const BRIDGE_CONFIG = {
  protocol: 1,
  registrationTimeoutMs: 10_000,
  serverSilenceTimeoutMs: 75_000,
  requestTimeoutMs: 60_000,
  reconnectMaxMs: 30_000,
  maxMessageBytes: 16 * 1024 * 1024,
  maxPendingRequests: 16,
  maxBufferedEvents: 256,
  maxBufferedBytes: 32 * 1024 * 1024,
  maxInspectionBytes: 15 * 1024 * 1024,
  minInspectionIntervalMs: 1000,
  maxInspectionIntervalMs: 60000,
} as const

/** Полный диагностический снимок для согласованной debug session. */
export const BRIDGE_SNAPSHOT_OPTIONS = {
  includeTelemetry: true,
  includeProblems: true,
  includeConfiguration: true,
  includeEffectiveConfiguration: true,
  includeDomain: true,
  includeProgram: true,
  includeRuntime: true,
  includeRaphData: true,
  includeRaphGraph: true,
} as const satisfies DiagnosticsSnapshotOptions

/** Структура Domain и Runtime без рабочих данных, render payload и графа Raph. */
export const BRIDGE_STRUCTURE_SNAPSHOT_OPTIONS = {
  ...BRIDGE_SNAPSHOT_OPTIONS,
  includeTelemetry: false,
  includeProblems: false,
  includeProgram: false,
  includeRaphData: false,
  includeRaphGraph: false,
} as const satisfies DiagnosticsSnapshotOptions

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
