import type { EndgeConfigurationContribution } from '@/modules/configuration/domain/types/configuration.type'
import type { DuplicateOptions } from '@/modules/domain/entities/REntity'

import { Serialize } from '@endge/utils'
import { Expose } from 'class-transformer'
import { normalizeEndgeConfigurationContribution } from '@/modules/configuration/domain/endge-configuration'
import { REntity } from '@/modules/domain/entities/REntity'

/** Сущность окружения (коллекция environments). Без привязки к проекту. */
export class REnvironment extends REntity {
  @Expose()
  configuration: EndgeConfigurationContribution = { mode: 'inherit', patch: {} }

  static fromPlain(input: Record<string, unknown>): REnvironment {
    const environment = Serialize.fromJSON(REnvironment, input)
    environment.configuration = normalizeEndgeConfigurationContribution(input.configuration)
    return environment
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      folderId: this.folderId ?? null,
      managedBy: this.managedBy,
      managedById: this.managedById,
      meta: { ...this.meta },
      configuration: this.configuration,
    }
  }

  override duplicate(options: DuplicateOptions): REnvironment {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return Serialize.fromJSON(REnvironment, plain)
  }
}
