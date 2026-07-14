import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { EndgeBindingsBehavior } from '@/model/endge/configuration/endge-bindings-behavior'
import { EndgeBindingsPresentation } from '@/model/endge/configuration/endge-bindings-presentation'
import { EndgeContracts } from '@/model/endge/configuration/endge-contracts'

/**
 * Lifecycle owner of configuration contracts and binding resolvers.
 * Concrete registries remain focused services and are exposed through this facade.
 */
export class EndgeConfiguration extends EndgeModule {
  public readonly contracts = new EndgeContracts()
  public readonly behaviorBindings = new EndgeBindingsBehavior()
  public readonly presentationBindings = new EndgeBindingsPresentation()

  public constructor() {
    super()
    this.contracts.subscribe(() => this.notify())
  }

  /** Registers the canonical core contracts after domain build. */
  public override start(): void {
    this.contracts.start()
  }

  /** Clears child registries together with the owning module. */
  public override reset(): void {
    this.contracts.reset()
  }
}
