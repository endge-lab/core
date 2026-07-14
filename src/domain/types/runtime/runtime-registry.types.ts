import type { RuntimeEntityType } from '@/domain/types/runtime/runtime-entity-map.types'
import type { RuntimeHost, RuntimeHostSnapshot } from '@/domain/types/runtime/runtime-host.types'

export interface RuntimeHostRegistrySnapshot {
  /** Общее количество зарегистрированных host. */
  total: number
  /** Группировка host по статусу. */
  byStatus: Record<string, number>
  /** Снимки всех host на момент запроса. */
  hosts: RuntimeHostSnapshot[]
  /** Общее количество удалённых host, сохранённых в debug-архиве. */
  deletedTotal: number
  /** Снимки удалённых host из debug-архива. */
  deletedHosts: RuntimeHostSnapshot[]
}

export interface RuntimeHostRegistryLike {
  /** Зарегистрировать host в registry и вернуть его же. */
  register<T extends RuntimeHost<any, any>>(host: T): T
  /** Найти host по runtime-id. */
  getById(id: string): RuntimeHost<any, any> | null
  /** Получить список всех host. */
  getAll(): RuntimeHost<any, any>[]
  /** Получить host для конкретной доменной сущности. */
  getByEntity(entityType: RuntimeEntityType, entityIdentity: string): RuntimeHost<any, any>[]
  /** Удалить host по runtime-id и вернуть удаленный экземпляр. */
  removeById(id: string): RuntimeHost<any, any> | null
  /** Очистить registry и разрушить все host. */
  clear(): void
  /** Сохранить snapshot удалённого host в debug-архив. */
  rememberDeletedSnapshot(snapshot: RuntimeHostSnapshot): void
  /** Получить снимки удалённых host из debug-архива. */
  getDeletedSnapshots(): RuntimeHostSnapshot[]
  /** Удалить один snapshot из debug-архива по runtime-id. */
  removeDeletedSnapshot(id: string): RuntimeHostSnapshot | null
  /** Очистить debug-архив удалённых host. */
  clearDeleted(): void
  /** Получить сериализованный snapshot registry. */
  snapshot(): RuntimeHostRegistrySnapshot
}
