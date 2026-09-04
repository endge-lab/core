import type { EndgeBootContext } from '@/features/core/kernel/types/bootstrap.types'
import type { WorkspaceVariables } from '@/features/core/modules/context/endge-vars'
import type { EndgeActions } from '@/features/core/modules/runtime/endge-actions'
import type { EndgeComposition } from '@/features/core/modules/runtime/execution/endge-composition'
import type { EndgeComputation } from '@/features/core/modules/runtime/execution/endge-computation'
import type { EndgeConverters } from '@/features/core/modules/runtime/execution/endge-converters'
import type { EndgeDataView } from '@/features/core/modules/runtime/execution/endge-data-view'
import type { EndgeQuery } from '@/features/core/modules/runtime/execution/endge-query'
import { ENDGE_CORE_MODULES } from '@/features/core/kernel/config/modules.config'
import { DomainSnapshotCodec } from '@/features/core/modules/domain-repository/services/DomainSnapshotCodec'
import { EndgeFederation } from '@/features/federation/EndgeFederation'

const EndgeCoreFederation = EndgeFederation.define({
  id: 'endge',
  name: 'Endge',
  modules: ENDGE_CORE_MODULES,
})

/**
 * Единая статическая федерация Endge.
 * Хост живёт в `globalThis`, поэтому `Endge` не дублируется даже если пакет подтянут из разных зависимостей.
 */
export class Endge extends EndgeCoreFederation {
  private static _domainSnapshot: DomainSnapshotCodec | null = null

  /**
   * Запрещает создание экземпляров `Endge`.
   * Федерация используется только через статический public API.
   */
  private constructor() {
    super()
  }

  /**
   * Запускает ядро по полному boot pipeline: `setup -> load -> build -> start`.
   * Метод является единственной централизованной точкой старта `Endge`.
   */
  static override boot(ctx: EndgeBootContext): Promise<void> {
    return super.boot(ctx)
  }

  /** Доступ к чистому codec локального Domain snapshot. */
  public static get domainSnapshot(): DomainSnapshotCodec {
    this._domainSnapshot ??= new DomainSnapshotCodec(snapshot => this.domain.materializeSnapshot(snapshot))
    return this._domainSnapshot
  }

  /**
   * @deprecated Используйте Endge.workspace.variables.
   */
  static get vars(): WorkspaceVariables {
    return this.workspace.variables
  }

  /**
   * @deprecated Используйте Endge.runtime.query.
   */
  static get query(): EndgeQuery {
    return this.runtime.query
  }

  /**
   * @deprecated Используйте Endge.runtime.dataView.
   */
  static get dataView(): EndgeDataView {
    return this.runtime.dataView
  }

  /** @deprecated Используйте Endge.runtime.composition. */
  static get composition(): EndgeComposition {
    return this.runtime.composition
  }

  /** Доступ к единому registry вызываемых runtime Actions. */
  static get actions(): EndgeActions {
    return this.runtime.actions
  }

  static get computations(): EndgeComputation {
    return this.runtime.computation
  }

  static get converters(): EndgeConverters {
    return this.runtime.converters
  }
}
