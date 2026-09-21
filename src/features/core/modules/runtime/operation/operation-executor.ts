import type { OperationHistory, OperationHistoryEntry } from '@/features/core/modules/runtime/operation/operation-history'

export interface RuntimeOperationContext {
  input: unknown
  runOutput?: unknown
  undoOutput?: unknown
}

export interface ExecuteRuntimeOperationOptions {
  id: string
  input: unknown
  history: OperationHistory | null
  recordHistory: boolean
  run: (context: RuntimeOperationContext) => Promise<unknown>
  undo: (context: RuntimeOperationContext) => Promise<unknown>
  redo?: ((context: RuntimeOperationContext) => Promise<unknown>) | null
}

/** Выполняет один неизменяемый snapshot Operation и владеет общей семантикой курсора History. */
export async function executeRuntimeOperation(options: ExecuteRuntimeOperationOptions): Promise<unknown> {
  const snapshot = cloneAndFreeze(options.input)
  if (!options.recordHistory || !options.history) {
    return options.run({ input: snapshot })
  }
  return options.history.execute(async () => {
    let runOutput = await options.run({ input: snapshot })
    let undoOutput: unknown
    const entry: OperationHistoryEntry = {
      id: options.id,
      input: snapshot,
      runOutput,
      undo: async () => {
        undoOutput = await options.undo({ input: snapshot, runOutput })
        return undoOutput
      },
      redo: async () => {
        if (options.redo) {
          return await options.redo({ input: snapshot, runOutput, undoOutput })
        }
        // Новый run создаёт новый результат для следующего undo; неудача сохраняет прежний.
        runOutput = await options.run({ input: snapshot })
        entry.runOutput = runOutput
        return runOutput
      },
    }
    return { result: runOutput, entry }
  })
}

function cloneAndFreeze<T>(value: T): T {
  const clone = typeof structuredClone === 'function'
    ? structuredClone(value)
    : value === undefined ? value : JSON.parse(JSON.stringify(value))
  return deepFreeze(clone)
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
  }
  return value
}
