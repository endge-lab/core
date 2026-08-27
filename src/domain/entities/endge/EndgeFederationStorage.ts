import type { EndgeStorageAdapter } from '@/domain/types/runtime/context-persistence.types'

let storageAdapter: EndgeStorageAdapter | null = null

/** Регистрирует platform adapter для persistence всех федераций. */
export function setEndgeFederationStorageAdapter(adapter: EndgeStorageAdapter | null): void {
  storageAdapter = adapter
}

/** Возвращает доступный platform adapter federation persistence. */
export function getEndgeFederationStorageAdapter(): EndgeStorageAdapter | null {
  return storageAdapter?.isAvailable() ? storageAdapter : null
}
