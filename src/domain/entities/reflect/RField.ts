import { Expose } from 'class-transformer'
import { TypeMap } from '@endge/utils'

export class RField {
  @Expose()
  name: string

  @Expose()
  type: string

  @Expose()
  isArray: boolean = false

  @Expose()
  optional: boolean = false

  @Expose()
  @TypeMap(RField, 'name')
  params?: Map<string, RField> // Если есть `params`, это метод

  constructor(
    name: string,
    type: string,
    isArray = false,
    optional = false,
    params?: Map<string, RField>,
  ) {
    this.name = name
    this.type = type
    this.isArray = isArray
    this.optional = optional
    this.params = params ?? new Map()
  }

  isMethod(): boolean {
    return this.params !== undefined && this.params.size > 0
  }
}
