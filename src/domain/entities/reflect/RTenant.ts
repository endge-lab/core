import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'

import type { DuplicateOptions } from '@/domain/entities/reflect/REntity'
import type { EndgeConfigurationContribution } from '@/domain/types/configuration'
import { REntity } from '@/domain/entities/reflect/REntity'

/** Сущность тенанта (коллекция tenants). */
export class RTenant extends REntity {
  @Expose()
  configuration: EndgeConfigurationContribution = { mode: 'inherit', patch: {} }

  @Expose()
  code!: string

  @Expose()
  override description: string | null = null

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      code: this.code,
      description: this.description ?? null,
      folderId: this.folderId ?? null,
      configuration: this.configuration,
    }
  }

  override duplicate(options: DuplicateOptions): RTenant {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.code = options.identity
    plain.folderId = null
    return Serialize.fromJSON(RTenant, plain)
  }
}
