import { Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'

/**
 * Source-first доменная сущность типа.
 */
export class RType extends REntity {
  //
  get id(): string {
    return this.name
  }

  @Expose()
  name: string

  @Expose()
  isPrimitive: boolean = false

  /** Каноническое структурное определение типа. */
  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  constructor(name: string) {
    super()
    this.name = name
  }
}
