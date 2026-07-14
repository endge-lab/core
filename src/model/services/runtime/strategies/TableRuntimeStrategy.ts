import { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import { TableRuntimeHost } from '@/domain/entities/runtime/hosts/TableRuntimeHost'
import type { RuntimeStrategy } from '@/model/services/runtime/RuntimeStrategy'

export class TableRuntimeStrategy implements RuntimeStrategy<RComponentTable> {
  public readonly id = 'runtime:table'
  public readonly entityType = 'table'

  public supports(model: unknown): model is RComponentTable {
    return model instanceof RComponentTable || (model as any)?.type === 'component-table'
  }

  public create(ctx: Parameters<RuntimeStrategy<RComponentTable>['create']>[0]) {
    return TableRuntimeHost.createRuntime({
      id: ctx.id,
      model: ctx.model,
      meta: ctx.meta,
      parent: ctx.parent,
    })
  }
}
