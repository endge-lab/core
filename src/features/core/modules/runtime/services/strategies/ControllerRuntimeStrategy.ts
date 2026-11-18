import type { ControllerModel } from '../../domain/controllers/controller.types'
import type { RuntimeStrategy } from '../../domain/runtime-strategy.types'
import type { ControllerRuntimeHost } from '../../hosts/ControllerRuntimeHost'

export class ControllerRuntimeStrategy implements RuntimeStrategy<ControllerModel, ControllerRuntimeHost> {
  public readonly id = 'runtime:controller'
  public readonly entityType = 'controller' as const
  public constructor(private readonly _createHost: RuntimeStrategy<ControllerModel, ControllerRuntimeHost>['create']) {}

  public supports(model: unknown): model is ControllerModel {
    return (model as ControllerModel)?.type === 'controller'
  }

  public create: RuntimeStrategy<ControllerModel, ControllerRuntimeHost>['create'] = context => this._createHost(context)
}
