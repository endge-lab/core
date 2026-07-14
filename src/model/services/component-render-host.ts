import type { RComponent } from '@/domain/types/component.types'
import type { RuntimeScope } from '@/domain/entities/runtime/RuntimeScope'
import type {
  ComponentType_Props,
  RenderComponentInfo,
} from '@/domain/types/types'
import { RenderComponentType } from '@/domain/types/types'
import type {
  UILegacyComponentRenderHost,
  UIResolvedLegacyComponentRenderer,
} from '@/domain/types/ui-composition.types'

import { Endge } from '@/model/endge/endge'

export function resolveEndgeComponentRenderer(input: {
  model: RComponent
  host: UILegacyComponentRenderHost
}): UIResolvedLegacyComponentRenderer | null {
  const instanceRenderer = input.model.getRenderer(input.host)
  if (instanceRenderer) {
    return {
      ref: `instance:${String(input.model.identity ?? input.model.id)}:${input.host}`,
      componentId: input.model.id ?? null,
      componentIdentity: input.model.identity ?? null,
      host: input.host,
      renderType: 'functional',
      component: instanceRenderer,
      label: input.model.name ?? input.model.identity ?? String(input.model.id),
    }
  }

  const resolvedByIdentity = Endge.uiRegistry.resolveLegacyComponentRenderer({
    componentId: input.model.id ?? null,
    componentIdentity: input.model.identity ?? null,
    host: input.host,
  })
  if (resolvedByIdentity) {
    return resolvedByIdentity
  }

  return Endge.uiRegistry.resolveLegacyComponentRenderer({
    componentIdentity: String(input.model.type ?? '').trim() || null,
    host: input.host,
  })
}

export function resolveEndgeComponentRenderInfo(input: {
  model: RComponent
  host: UILegacyComponentRenderHost
}): RenderComponentInfo | null {
  const renderer = resolveEndgeComponentRenderer(input)
  if (!renderer) {
    return null
  }

  return {
    type: renderer.renderType === 'component'
      ? RenderComponentType.Component
      : RenderComponentType.Functional,
    component: renderer.component,
  }
}

export function renderEndgeComponent(input: {
  h: any
  model: RComponent
  comData: Record<string, any>
  scope?: RuntimeScope
  host: UILegacyComponentRenderHost
  context?: Record<string, any>
}): any {
  const resolved = resolveEndgeComponentRenderer({
    model: input.model,
    host: input.host,
  })
  if (!resolved) {
    return input.h('div', {}, `renderer_not_found:${String(input.model.identity ?? input.model.id)}`)
  }

  const props: ComponentType_Props<RComponent> = {
    model: input.model,
    comData: input.comData,
    scope: input.scope,
    context: input.context,
  }

  if (resolved.renderType === 'component') {
    return input.h(resolved.component, props)
  }

  return resolved.component(input.h, props)
}
