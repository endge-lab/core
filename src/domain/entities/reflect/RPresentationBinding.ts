import { Expose } from 'class-transformer'

import type { EndgeBindingMode } from '@/domain/types/configuration/resolve.types'

import { REntity } from '@/domain/entities/reflect/REntity'

/** Сущность биндинга отображения (коллекция presentation-bindings). */
export class RPresentationBinding extends REntity {
  @Expose()
  projectId: number | null = null

  @Expose()
  ownerType: string = 'project'

  @Expose()
  ownerId: number | null = null

  @Expose()
  targetType: string = 'component'

  @Expose()
  targetId: number | null = null

  @Expose()
  role: string = ''

  @Expose()
  rendererRef: string = ''

  @Expose()
  when: string | null = null

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
      role: this.role,
      rendererRef: this.rendererRef,
      when: this.when ?? null,
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
