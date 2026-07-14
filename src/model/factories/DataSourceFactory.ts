import type { DataSource } from '@/domain/entities/data/DataSource'
import { DataSourceGQL } from '@/domain/data-source-graphql'
import { DataSourceRest } from '@/domain/data-source-rest'

import {QueryType} from "@/domain/types/document/document.types";

/**
 * Фабрика для создания и кэширования источников данных по типу запроса.
 * Источники данных кешируются по типу запроса, чтобы избежать повторного создания.
 */
export class DataSourceFactory {
  private static cache = new Map<QueryType, DataSource>()

  static get(type: QueryType): DataSource {
    // Проверка кэша
    const cached = this.cache.get(type)
    if (cached) return cached

    // Создание нового инстанса
    let instance: DataSource

    switch (type) {
      case QueryType.GraphQL:
        instance = new DataSourceGQL()
        break

      case QueryType.REST:
        instance = new DataSourceRest()
        break

      default:
        throw new Error(`Unknown QueryType: ${type}`)
    }

    this.cache.set(type, instance)
    return instance
  }

  /**
   * Очистка кэша (полностью или по типу)
   */
  static clear(type?: QueryType): void {
    if (type) {
      this.cache.delete(type)
    } else {
      this.cache.clear()
    }
  }
}
