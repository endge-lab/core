import type {
  DiagnosticsSeverityNumber,
  EndgeDiagnosticsConfiguration,
} from '@/domain/types/diagnostics'

/** Системная diagnostics configuration для workspace без явных настроек. */
export const DEFAULT_ENDGE_DIAGNOSTICS_CONFIGURATION: Readonly<EndgeDiagnosticsConfiguration> = Object.freeze({
  telemetry: {
    collection: {
      enabled: true,
      signals: ['log', 'span'],
      minSeverity: 9,
      maxRecords: 2_000,
    },
    outputs: [
      {
        id: 'output-1',
        name: 'Канал вывода 1',
        enabled: true,
        adapterType: 'console',
        options: {
          format: 'pretty',
          groupByTrace: true,
          includeTimestamp: true,
          includeScope: true,
          includeAttributes: true,
        },
      },
    ],
    routes: [
      {
        id: 'runtime-fatal-console',
        name: 'Runtime fatal errors',
        enabled: true,
        match: {
          signals: ['log'],
          phases: ['runtime'],
          minSeverity: 21,
        },
        outputId: 'output-1',
      },
    ],
  },
  snapshots: {
    content: {
      telemetry: true,
      problems: true,
      configuration: false,
    },
    automatic: {
      enabled: false,
      errorCount: 10,
      windowSeconds: 60,
      cooldownSeconds: 300,
      outputIds: ['output-1'],
    },
  },
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
