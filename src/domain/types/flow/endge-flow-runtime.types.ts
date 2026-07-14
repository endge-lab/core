import type { FlowValidationIssue } from '@/domain/types/flow/action.types'

/**
 * Состояние выполнения action-flow.
 * Это единственный runtime-state flow, который разделяют executor, handlers и runtime-host.
 */
export interface FlowExecutionState {
  /** Нормализованный input, с которым был запущен flow. */
  input: Record<string, unknown>

  /** Снимки исполнения шагов, индексированные по node-id. */
  steps: Record<string, Record<string, unknown>>

  /** Локальное изменяемое хранилище flow. */
  locals: Record<string, unknown>

  /** Глобальные runtime-метаданные текущего запуска flow. */
  globals: Record<string, unknown>

  /** Снимок последнего исполненного шага. */
  lastStep: Record<string, unknown> | null
}

/**
 * Результат исполнения action-flow.
 */
export interface FlowExecutionResult {
  /** Удалось ли выполнить flow без validation/runtime issues. */
  ok: boolean

  /** Итоговое состояние выполнения flow. */
  state: FlowExecutionState

  /** Список validation/runtime проблем, обнаруженных при исполнении flow. */
  issues: FlowValidationIssue[]
}
