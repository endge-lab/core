import type { DiagnosticsAttributeScalar } from '@/domain/types/diagnostics'

/** JSON-safe настройки одного Sentry diagnostics output. */
export interface SentryDiagnosticsAdapterOptions {
  /** DSN проекта Sentry; поддерживает `{{ VARIABLE }}` через WorkspaceVariables. */
  dsn: string
  /** Имя окружения Sentry, например development или production. */
  environment?: string
  /** Версия приложения, используемая Sentry Releases. */
  release?: string
  /** Логическое имя runtime instance. */
  serverName?: string
  /** Optional tunnel endpoint для proxying Sentry envelopes. */
  tunnel?: string
  /** Отправлять diagnostics snapshots как JSON attachment. */
  sendSnapshots?: boolean
  /** Timeout одного ingestion request в миллисекундах. */
  requestTimeoutMs?: number
  /** Статические tags, добавляемые ко всем событиям output. */
  tags?: Record<string, DiagnosticsAttributeScalar>
}
