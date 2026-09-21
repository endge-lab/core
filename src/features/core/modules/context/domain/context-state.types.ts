import type { ClassConstructor } from 'class-transformer'

/** Ручное преобразование между runtime-состоянием и JSON-compatible представлением. */
export interface EndgeContextStateCodec<T> {
  serialize: (state: T) => unknown
  deserialize: (value: unknown) => T
}

/**
 * Способ преобразования dynamic state: class-transformer constructor либо ручной codec.
 * Без transform значение сохраняется как обычное JSON-compatible значение.
 */
export type EndgeContextStateTransform<T>
  = | ClassConstructor<T>
    | EndgeContextStateCodec<T>

export type EndgeContextStateListener = () => void
