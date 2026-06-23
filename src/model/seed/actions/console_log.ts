import type { ActionRuntimeHostContext } from '@/domain/types/runtime-host.types'

/** Логирует полный контекст шага (в т.ч. context.input). */
export function consoleLog(context: ActionRuntimeHostContext): void {
  // eslint-disable-next-line no-console
  console.log(context.input)
}
