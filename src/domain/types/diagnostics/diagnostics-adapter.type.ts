import type {
  DiagnosticsRecord,
  DiagnosticsResource,
  DiagnosticsSnapshot,
  EndgeDiagnosticsOutputConfiguration,
} from './diagnostics.types'

/** Возможности, которые конкретный тип diagnostics adapter предоставляет ядру. */
export interface DiagnosticsAdapterCapabilities {
  records: boolean
  snapshots: boolean
  test: boolean
}

/** Контекст создания runtime adapter для одного настроенного канала вывода. */
export interface DiagnosticsAdapterCreateContext {
  sessionId: string
  resource: DiagnosticsResource

  /** Разрешает persisted variable token без сохранения полученного секрета в configuration. */
  resolveVariable?: (value: string) => string | undefined
}

/** Контекст доставки одной записи после применения route. */
export interface DiagnosticsAdapterRecordContext extends DiagnosticsAdapterCreateContext {
  routeIds: string[]
  output: EndgeDiagnosticsOutputConfiguration
}

/** Контекст доставки диагностического снимка. */
export interface DiagnosticsAdapterSnapshotContext extends DiagnosticsAdapterCreateContext {
  output: EndgeDiagnosticsOutputConfiguration
  trigger: DiagnosticsSnapshot['trigger']
}

/** Runtime adapter, созданный для одного output из effective configuration. */
export interface DiagnosticsAdapter {
  readonly id: string

  /** Принимает record, прошедший маршрутизацию в текущий output. */
  acceptRecord(record: DiagnosticsRecord, context: DiagnosticsAdapterRecordContext): void | Promise<void>

  /** Принимает полный JSON-safe snapshot, если adapter поддерживает snapshots. */
  acceptSnapshot?(snapshot: DiagnosticsSnapshot, context: DiagnosticsAdapterSnapshotContext): void | Promise<void>

  /** Проверяет доступность output без изменения diagnostics history. */
  test?(): void | Promise<void>

  /** Доставляет накопленный adapter buffer без завершения session. */
  flush?(): void | Promise<void>

  /** Освобождает внешние ресурсы adapter при пересборке или reset. */
  dispose?(): void | Promise<void>
}

/** Фабрика одного расширяемого типа diagnostics adapter. */
export interface DiagnosticsAdapterFactory {
  readonly type: string
  readonly capabilities: DiagnosticsAdapterCapabilities

  /** Создаёт runtime adapter для конкретного output из effective configuration. */
  create(
    output: EndgeDiagnosticsOutputConfiguration,
    context: DiagnosticsAdapterCreateContext,
  ): DiagnosticsAdapter
}

/** Результат best-effort flush всех активных output adapters. */
export interface DiagnosticsFlushResult {
  succeeded: string[]
  failed: Array<{ outputId: string, error: unknown }>
}
