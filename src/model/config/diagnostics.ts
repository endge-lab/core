import type {
  DiagnosticsSeverityNumber,
  EndgeDiagnosticsConfiguration,
} from '@/domain/types/diagnostics'

/** Системная diagnostics configuration для workspace без явных настроек. */
export const DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION: Readonly<EndgeDiagnosticsConfiguration> = Object.freeze({
  collection: {
    enabled: true,
    signals: ['log', 'span'],
    minSeverity: 9,
    maxRecords: 2_000,
  },
  routes: [],
} satisfies EndgeDiagnosticsConfiguration)

/** Текстовое представление базовых значений OpenTelemetry SeverityNumber. */
export const DIAGNOSTICS_SEVERITY_TEXT: Record<DiagnosticsSeverityNumber, 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'> = {
  1: 'TRACE',
  5: 'DEBUG',
  9: 'INFO',
  13: 'WARN',
  17: 'ERROR',
  21: 'FATAL',
}
