import type { RenderComponentInfo } from '@/domain/types/types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RenderComponentType } from '@/domain/types/types'
import { Endge } from '@/model/endge/endge'

/**
 * Совместимый facade старого render registry поверх `Endge.uiRegistry`.
 */
export class EndgeRender extends EndgeModule {
  /**
   * @deprecated Используйте Endge.uiRegistry.registerLegacyComponentRenderer.
   * Совместимый фасад поверх единого uiRegistry.
   */
  public register(
    type: string,
    renderType: RenderComponentType,
    component: any,
  ): void {
    Endge.uiRegistry.registerLegacyComponentRenderer({
      ref: type,
      componentIdentity: type,
      host: 'view',
      renderType,
      component,
    })
    this.notify()
  }

  /**
   * @deprecated Используйте Endge.uiRegistry.getLegacyComponentRendererByRef.
   */
  public get(type: string): RenderComponentInfo | undefined {
    const renderer = Endge.uiRegistry.getLegacyComponentRendererByRef(type)
    if (!renderer) {
      return undefined
    }

    return {
      type: renderer.renderType === 'component'
        ? RenderComponentType.Component
        : RenderComponentType.Functional,
      component: renderer.component,
    }
  }

  /**
   * @deprecated Используйте Endge.uiRegistry.serialize().legacyRenderers
   */
  public getKeys(): string[] {
    return Endge.uiRegistry.serialize().legacyRenderers
  }
}
