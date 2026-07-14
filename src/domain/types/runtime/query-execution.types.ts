import type { QueryProgramPayload } from '@/domain/types/program/program.types'

/** Runtime context одного выполнения compiled query artifact. */
export interface QueryExecutionContext {
  /** Runtime-ready query payload из Endge.program. */
  payload: QueryProgramPayload

  /** Входные параметры одноразового или реактивного запуска. */
  vars?: Record<string, unknown>

  /** AbortSignal текущего runtime run. */
  signal?: AbortSignal
}
