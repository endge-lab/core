import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { FilterProgramPayload } from '@/domain/types/filter-source.types'
import type { CompositionFilterFieldsSlice } from '@/domain/types/composition-source.types'
import type { RuntimeHost, RuntimeHostContext } from '@/domain/types/runtime-host.types'

import { RuntimeHostBase } from '@/domain/entities/runtime/RuntimeHostBase'
import type { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'

function defaultContext(instance: string): RuntimeHostContext<'filter'> {
  return {
    status: 'idle',
    startedAt: null,
    updatedAt: null,
    instance,
    lastStateChangeAt: null,
  }
}

/** Renderable runtime-slice над одним FilterRuntimeHost без собственного filter state. */
export class FilterFieldsRuntimeHost extends RuntimeHostBase<'filter', RuntimeHostContext<'filter'>, FilterProgramPayload> {
  public constructor(input: {
    id: string
    name: string
    model: RFilter
    sourceRuntimeName: string
    sourceRuntime: FilterRuntimeHost
    fieldKeys: string[]
    parent?: RuntimeHost<any, any> | null
    meta?: Record<string, unknown>
  }) {
    super({
      id: input.id,
      model: input.model,
      parent: input.parent,
      meta: {
        ...(input.meta ?? {}),
        sourceRuntimeId: input.sourceRuntime.id,
        sourceRuntimeName: input.sourceRuntimeName,
        fieldKeys: [...input.fieldKeys],
      },
      kind: 'runtime',
      runtimeType: 'filter-fields-runtime-host',
      entityType: 'filter',
      entityIdentity: input.model.identity ?? String(input.model.id),
      title: input.name,
      context: defaultContext(input.name),
    })
    this._sourceRuntime = input.sourceRuntime
    this._sourceRuntimeName = input.sourceRuntimeName
    this._fieldKeys = [...input.fieldKeys]
  }

  private _sourceRuntime: FilterRuntimeHost
  private _sourceRuntimeName: string
  private _fieldKeys: string[]

  public getFilterRuntime(): FilterRuntimeHost {
    return this._sourceRuntime
  }

  public getFieldKeys(): string[] {
    return [...this._fieldKeys]
  }

  public getSlice(): CompositionFilterFieldsSlice {
    const state = this._sourceRuntime.getState()
    return {
      kind: 'filter-fields',
      runtimeId: this._sourceRuntime.id,
      runtimeName: this._sourceRuntimeName,
      fieldKeys: [...this._fieldKeys],
      fields: this._sourceRuntime.getFields().filter(field => this._fieldKeys.includes(field.key)),
      values: Object.fromEntries(this._fieldKeys.map(key => [key, state[key]])),
    }
  }
}
