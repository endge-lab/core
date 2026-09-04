import type { DuplicateOptions } from '@/features/core/modules/domain/entities/REntity'
import { Serialize } from '@endge/utils'

import { Exclude, Expose } from 'class-transformer'
import { REntity } from '@/features/core/modules/domain/entities/REntity'
import { CONFIGURATION_DEFAULT_SOURCE } from '@/features/core/modules/source/templates/configuration.default.source'

/** Принадлежащий Workspace Source-документ, объявляющий одну категорию настроек. */
export class RConfiguration extends REntity {
  @Exclude()
  readonly type = 'configuration' as const

  @Expose()
  override description: string | null = null

  @Expose()
  source = CONFIGURATION_DEFAULT_SOURCE

  @Expose()
  sourceVersion = 1

  static fromPlain(json: any, storageMeta?: any): RConfiguration {
    const configuration = new RConfiguration()
    configuration.id = json?.id
    configuration.identity = String(json?.identity ?? '').trim()
    configuration.name = String(json?.name ?? json?.displayName ?? configuration.identity)
    configuration.displayName = String(json?.displayName ?? configuration.name)
    configuration.description = json?.description ?? null
    configuration.source = typeof json?.source === 'string' ? json.source : CONFIGURATION_DEFAULT_SOURCE
    configuration.sourceVersion = Number(json?.sourceVersion) === 1 ? 1 : Number(json?.sourceVersion ?? 1)
    configuration.folderId = null
    configuration.applyEntityMeta(json)
    configuration.applyManagement(json)
    configuration.active = json?.active ?? null
    configuration.deletedAt = json?.deletedAt ?? null
    configuration.author = json?.author ?? null
    if (storageMeta) {
      configuration.applyStorageMeta(storageMeta)
    }
    return configuration
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName || this.name,
      description: this.description,
      source: this.source,
      sourceVersion: this.sourceVersion,
      folderId: null,
      meta: this.meta ?? {},
      active: this.active !== false,
      managedBy: this.managedBy,
      managedById: this.managedById,
      deletedAt: this.deletedAt ?? null,
      author: this.author ?? null,
    }
  }

  override duplicate(options: DuplicateOptions): RConfiguration {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return RConfiguration.fromPlain(plain)
  }
}
