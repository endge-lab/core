import type { OperationHistory } from '@/features/core/modules/runtime/operation/operation-history'

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
  const runOutput = await options.run({ input: snapshot })
  if (!options.recordHistory) {
    return runOutput
  }

  let undoOutput: unknown
  options.history?.commit({
    id: options.id,
    input: snapshot,
    runOutput,
    undo: async () => {
      undoOutput = await options.undo({ input: snapshot, runOutput })
      return undoOutput
    },
    redo: async () => await (options.redo ?? options.run)({ input: snapshot, runOutput, undoOutput }),
  })
  return runOutput
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
