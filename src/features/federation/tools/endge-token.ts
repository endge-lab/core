import type { EndgeEventMap, EndgeToken } from '@/features/federation/types/forge.types'

/** Создаёт типизированный идентификатор federation service. */
export function endgeToken<T, E extends EndgeEventMap = object>(id: string): EndgeToken<T, E> {
  return id as EndgeToken<T, E>
}
