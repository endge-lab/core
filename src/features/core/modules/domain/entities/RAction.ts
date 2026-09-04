import type { ActionImplementation, ActionTargetSelector } from '@/features/core/modules/actions/domain/action.types'
import type { DuplicateOptions } from '@/features/core/modules/domain/entities/REntity'

import type { EntityRef } from '@/features/core/modules/domain/types/document/entity-management.type'
import { Serialize } from '@endge/utils'

import { Expose } from 'class-transformer'
import { REntity } from '@/features/core/modules/domain/entities/REntity'

/** Каноническое определение Action на основе Source. Исполняемый код предоставляет провайдер. */
export class RAction extends REntity {
  @Expose()
  override displayName: string = ''

  @Expose()
  override description: string | null = null

  @Expose()
  source: string = ''

  @Expose()
  sourceVersion: number = 1

  @Expose()
  target: ActionTargetSelector[] | null = null

  @Expose()
  contract: { input: unknown | null, output: unknown | null } = { input: null, output: null }

  @Expose()
  defaultImplementation: ActionImplementation = { kind: 'source' }

  @Expose()
  owner?: EntityRef

  static fromPlain(json: any, storageMeta?: any): RAction {
    const action = new RAction()
    action.id = json?.id
    action.identity = String(json?.identity ?? '').trim()
    action.name = String(json?.name ?? json?.displayName ?? action.identity)
    action.displayName = String(json?.displayName ?? action.name)
    action.description = json?.description ?? null
    action.source = typeof json?.source === 'string' ? json.source : ''
    action.sourceVersion = Math.max(1, Number(json?.sourceVersion ?? 1) || 1)
    action.target = Array.isArray(json?.target) ? json.target.map((selector: any) => ({ ...selector })) : null
    action.contract = {
      input: json?.contract?.input ?? null,
      output: json?.contract?.output ?? null,
    }
    action.defaultImplementation = json?.defaultImplementation?.kind
      ? { ...json.defaultImplementation }
      : { kind: 'source' }
    action.owner = json?.owner
    action.folderId = json?.folderId ?? relationToId(json?.folder) ?? null
    action.applyEntityMeta(json)
    action.active = json?.active !== false
    action.deletedAt = json?.deletedAt ?? null
    action.author = json?.author ?? null
    if (storageMeta) {
      action.applyStorageMeta(storageMeta)
    }
    return action
  }

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName,
      description: this.description,
      source: this.source,
      sourceVersion: this.sourceVersion,
      target: this.target?.map(selector => ({ ...selector })) ?? null,
      contract: { ...this.contract },
      defaultImplementation: { ...this.defaultImplementation },
      ...(this.owner ? { owner: { ...this.owner } } : {}),
      folderId: this.folderId ?? null,
      meta: this.meta ?? {},
      active: this.active !== false,
      deletedAt: this.deletedAt ?? null,
      author: this.author ?? null,
    }
  }

  override duplicate(options: DuplicateOptions): RAction {
    const plain = Serialize.toPlain(this) as Record<string, any>
    const name = (options.name ?? options.identity).trim() || options.identity
    plain.id = undefined
    plain.identity = options.identity
    plain.name = name
    plain.displayName = name
    plain.folderId = null
    return RAction.fromPlain(plain)
  }
}

function relationToId(value: any): string | number | null {
  if (value == null) {
    return null
  }
  if (typeof value === 'object') {
    return relationToId(value.id ?? value.value)
  }
  return value
}
