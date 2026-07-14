import { Expose } from 'class-transformer'

import { RComponentBase } from '@/domain/entities/reflect/RComponentBase'

/** Архивный DSL-документ без compile/runtime поведения. */
export class RComponentDSL extends RComponentBase {
  @Expose()
  jsxScript: string = ''
}
