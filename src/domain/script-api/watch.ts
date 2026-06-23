import { EndgeStore } from '@/model/endge/endge-store'
import type { StoreWriter } from '@/domain/entities/runtime/RuntimeContext'
import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'

/**
 * Функция watch, предоставляемая в RuntimeContext.
 * При вызове с queryId возвращает .to(...), но если .to не будет вызвана вручную - выполнится автоматически.
 */
export function apiWatch(scope: RuntimeScope, queryId: string): StoreWriter {
  let called = false

  const api = {
    to: async (storeKey: string = EndgeStore.Default) => {
      called = true

      //
      //
      //
    },
  }

  // Автоматический вызов через 1 тик, если .to() не вызвана
  setTimeout(() => {
    if (!called) {
      api.to()
    }
  }, 0)

  return api
}
