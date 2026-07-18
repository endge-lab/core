import { Exclude, Expose } from 'class-transformer'

import { REntity } from '@/domain/entities/reflect/REntity'
import type { EntityManagement } from '@/domain/types/document'

export interface RConverterSchema extends EntityManagement {
  id: number
  name: string
  description?: string | null
}

export class RConverter extends REntity {
  @Expose()
  description: string | null = null

  @Exclude()
  customHandler: ((v: any) => any) | undefined = undefined

  setCustom(fn: ((v: any) => any) | undefined): void {
    this.customHandler = fn
  }

  convert(v: any): any {
    if (this.customHandler) {
      return this.customHandler(v)
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
    }
  }
}
