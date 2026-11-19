import type {
  DiagnosticsSeverityNumber,
  EndgeDiagnosticsConfiguration,
  EndgeDiagnosticsSnapshotContentConfiguration,
} from '@/features/core/modules/diagnostics/domain/types/diagnostics.types'

export const DEFAULT_ENDGE_DIAGNOSTICS_RECORDING_CONTENT: Readonly<EndgeDiagnosticsSnapshotContentConfiguration> = Object.freeze({
  telemetry: true,
  problems: true,
  configuration: false,
  effectiveConfiguration: false,
  domain: false,
  program: false,
  runtime: true,
  raphData: false,
  raphGraph: false,
})

// Системная diagnostics configuration для workspace без явных настроек.
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
  recording: { enabled: false, content: DEFAULT_ENDGE_DIAGNOSTICS_RECORDING_CONTENT },
  snapshots: {
    content: {
      telemetry: true,
      problems: true,
      configuration: false,
      effectiveConfiguration: true,
      domain: true,
      program: true,
      runtime: true,
      raphData: true,
      raphGraph: true,
    },
    shortcut: {
      triggerSet: [],
      content: {
        telemetry: true,
        problems: true,
        configuration: false,
        effectiveConfiguration: true,
        domain: true,
        program: true,
        runtime: true,
        raphData: true,
        raphGraph: true,
      },
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

// Текстовое представление базовых значений OpenTelemetry SeverityNumber.
export const DIAGNOSTICS_SEVERITY_TEXT: Record<DiagnosticsSeverityNumber, 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL'> = {
  1: 'TRACE',
  5: 'DEBUG',
  9: 'INFO',
  13: 'WARN',
  17: 'ERROR',
  21: 'FATAL',
}
