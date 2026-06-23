import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'

/**
 * Функция expose, предоставляемая в RuntimeContext.
 * Помечает функции, как экспортируемые в JSX.
 */
export function apiExpose(
  scope: RuntimeScope,
  data: Record<string, CallableFunction>,
): void {
  scope.export.names = data
}
