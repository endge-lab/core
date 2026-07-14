import { QueryType } from '@/domain/types/document/document.types'

import { Expose } from 'class-transformer'

import { Endge } from '@/model/endge/kernel/endge'
import { REntity } from '@/domain/entities/reflect/REntity'

/**
 * Persisted Query document.
 *
 * Все transport, mock, input и output contracts живут исключительно в source;
 * RQuery хранит только общие document-поля и source.
 */
export class RQuery extends REntity {
  /** Внутренний document type для существующих registries; не persisted transport config. */
  type: QueryType = QueryType.REST

  /** Единственный persisted authoring-контракт Query. */
  @Expose()
  source: string = ''

  /** Версия Query source syntax. */
  @Expose()
  sourceVersion: number = 2

  /** Выполняет скомпилированный source Query через one-shot runtime session. */
  async run(props: Record<string, unknown> = {}): Promise<any> {
    return Endge.runtime.query.run(this, props)
  }
}
