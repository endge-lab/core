import { Expose } from 'class-transformer'
import { REntity } from '@/modules/domain/entities/REntity'

/**
 * Source-first доменная сущность типа.
 */
export class RType extends REntity<string> {
  @Expose()
  override id: string

  @Expose()
  override name: string

  @Expose()
  isPrimitive: boolean = false

  /** Каноническое структурное определение типа. */
  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  constructor(name = '') {
    super()
    this.id = name
    this.name = name
  }
}
