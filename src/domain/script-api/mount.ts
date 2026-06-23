import { RuntimeEventType } from '@/domain/entities/runtime/RuntimeScope'
import { EndgeStore } from '@/model/endge/endge-store'
import type { StoreReader } from '@/domain/entities/runtime/RuntimeContext'
import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'

/**
 * Функция mount, предоставляемая в RuntimeContext.
 * При вызове с componentId возвращает .from(...), но если .from не будет вызвана вручную - выполнится автоматически.
 */
export function apiMount(
  scope: RuntimeScope,
  componentId: string,
): StoreReader {
  let called = false

  const api = {
    from: async (storeKey: string = EndgeStore.Default) => {
      called = true
      scope.ui.componentMountedId = componentId
      scope.ui.componentMountedStoreId = storeKey

      //
      scope.emit(RuntimeEventType.Mounted, {
        componentId,
        storeKey: storeKey,
      })
    },
  }

  // Автоматический вызов через 1 тик, если .from() не вызвана
  setTimeout(() => {
    if (!called) {
      api.from()
    }
  }, 0)

  return api
}
