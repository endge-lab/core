import type { QueryType } from '@/domain/types/document.types'
import type { RQueryAuth, RQueryFilterApplyMode } from '@/domain/types/query.types'
import type { Nullable } from '@endge/utils'

import { Serialize, TypeMap } from '@endge/utils'
import { Exclude, Expose, Type } from 'class-transformer'

import { Endge } from '@/model/endge/endge'
import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import { REntity } from '@/domain/entities/reflect/REntity'
import { RField } from '@/domain/entities/reflect/RField'
import { RQueryFilter } from '@/domain/entities/reflect/RQueryFilter'

export class RQuery extends REntity {
  @Expose()
  type!: QueryType

  @Expose()
  query!: string

  @Expose({ name: 'return' })
  @Type(() => RField)
  returnField!: RField

  @Expose()
  endpoint!: string

  @Expose()
  subField!: string = 'items'

  @Expose()
  @TypeMap(RField, 'name')
  params: Map<string, RField> = new Map()

  @Expose()
  mockData!: string

  @Expose()
  mockDataEnabled: boolean = false

  @Expose()
  auth: RQueryAuth = { mode: 'token' }

  @Exclude()
  customExecutor: Nullable<() => Promise<any>> = null

  @Exclude()
  customGenerator: Nullable<(opts: { count: number }) => Promise<any>> = null

  /** Режим применения списка фильтров (пока только слияние). */
  @Expose()
  filterMode: RQueryFilterApplyMode = 'merge'

  @Expose()
  @Type(() => RQueryFilter)
  filters: RQueryFilter[] = []

  constructor(name?: string, returnField?: RField) {
    super()
    if (name) {
      this.name = name
    }
    if (returnField) {
      this.returnField = returnField
    }
  }

  /**
   * Установка кастомных функций генерации и выполнения запроса
   * @param opts.executor - функция выполнения запроса
   * @param opts.generator - функция генерации данных (для моков)
   */
  override(opts: {
    executor?: () => Promise<any>
    generator?: (opts: { count: number }) => Promise<any>
  }): void {
    if (opts.executor) {
      this.customExecutor = opts.executor
    }
    if (opts.generator) {
      this.customGenerator = opts.generator
    }
  }

  addParam(name: string, type: RField): void {
    this.params.set(name, type)
  }

  getParams(): Map<string, RField> {
    return this.params
  }

  /**
   * Выполнение запроса
   */
  async run(params: object = {}): Promise<any> {
    return Endge.query.run(this, params)
  }

  override duplicate(options: DuplicateOptions): RQuery {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(RQuery, plain)
  }
}
