import { Exclude, Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'
import type { EntityManagement } from '@/domain/types/document/entity-management.type'

export interface RConverterSchema extends EntityManagement {
  id: number
  name: string
  description?: string | null
  meta: Record<string, unknown>
}

export class RConverter extends REntity {
  @Expose()
  description: string | null = null

  @Exclude()
  customHandler: ((v: any, options?: Record<string, unknown>) => any) | undefined = undefined

  setCustom(fn: ((v: any, options?: Record<string, unknown>) => any) | undefined): void {
    this.customHandler = fn
  }

  convert(v: any, options?: Record<string, unknown>): any {
    if (this.customHandler) {
      return this.customHandler(v, options)
    }
    return null
  }

  toPlain(): RConverterSchema {
    return {
      id: this.id,
      name: this.name,
      description: this.description ?? null,
      managedBy: this.managedBy,
      managedById: this.managedById,
      meta: { ...this.meta },
    }
  }
}
