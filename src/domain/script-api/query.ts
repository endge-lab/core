import { EndgeStore } from '@/model/endge/endge-store'
import type { StoreWriter } from '@/domain/entities/runtime/RuntimeContext'
import { Endge } from '@/model/endge/endge'
import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import { Raph } from '@endge/raph'

/**
 * Функция query, предоставляемая в RuntimeContext.
 * При вызове с queryId возвращает .to(...), но если .to не будет вызвана вручную - выполнится автоматически.
 */
export function apiQuery(scope: RuntimeScope, queryId: string): StoreWriter {
  let called = false

  const api = {
    to: async (storeKey: string = EndgeStore.Default) => {
      called = true

      // Получаем запрос
      const query = Endge.domain.getQuery(queryId)
      if (!query) {
        throw new Error(`Query with id "${queryId}" not found`)
      }

      const data = await query.run()

      // Обновляем состояние в хранилище
      Raph.app.set(storeKey, data)
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
