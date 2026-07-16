import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

/**
 * Lifecycle boundary for the future EndgeCSS compiler/runtime.
 *
 * RStyle is currently persisted and edited as source only. Compilation and
 * renderer-specific application deliberately remain outside this stage.
 */
export class EndgeStyles extends EndgeModule {
  public override start(): void {}
}
