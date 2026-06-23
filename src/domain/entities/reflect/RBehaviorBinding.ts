import { Expose } from 'class-transformer'

import type { EndgeBindingMode } from '@/domain/types/resolve.types'

import { REntity } from '@/domain/entities/reflect/REntity'

/** Сущность биндинга поведения (коллекция behavior-bindings). */
export class RBehaviorBinding extends REntity {
  @Expose()
  projectId: number | null = null

  @Expose()
  ownerType: string = 'view'

  @Expose()
  ownerId: number | null = null

  @Expose()
  targetType: string = 'view'

  @Expose()
  targetId: number | null = null

  @Expose()
  eventName: string = ''

  @Expose()
  scriptRef: string = ''

  @Expose()
  mode: EndgeBindingMode = 'replace'

  @Expose()
  priority: number = 0

  @Expose()
  isEnabled: boolean = true

  @Expose()
  environmentId: number | null = null

  @Expose()
  isInherited: boolean = false

  @Expose()
  originBindingId: number | null = null

  toPlain(): Record<string, unknown> {
    return {
      id: this.id,
      identity: this.identity,
      name: this.name,
      displayName: this.displayName ?? this.name,
      projectId: this.projectId ?? null,
      ownerType: this.ownerType,
      ownerId: this.ownerId,
      targetType: this.targetType,
      targetId: this.targetId,
      eventName: this.eventName,
      scriptRef: this.scriptRef,
      mode: this.mode,
      priority: this.priority,
      isEnabled: this.isEnabled === true,
      environmentId: this.environmentId ?? null,
      isInherited: this.isInherited === true,
      originBindingId: this.originBindingId ?? null,
      folderId: this.folderId ?? null,
    }
  }
}
