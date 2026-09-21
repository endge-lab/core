import { Expose } from 'class-transformer'

import { RComponentBase } from '@/features/core/modules/domain/entities/RComponentBase'

/** Архивный DSL-документ без compile/runtime поведения. */
export class RComponentDSL extends RComponentBase {
  @Expose()
  jsxScript: string = ''
}
