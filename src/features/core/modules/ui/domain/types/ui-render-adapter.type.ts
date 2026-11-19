export type { EndgeSFCRenderAdapterKey, EndgeSFCRendererTag } from '@/features/core/modules/domain/types/component/sfc/renderer-tags'
export { ENDGE_SFC_RENDER_ADAPTER_REQUIRED_KEYS, ENDGE_SFC_RENDERER_TAGS, isEndgeSFCRendererTag } from '@/features/core/modules/domain/types/component/sfc/renderer-tags'

// Протокол renderer-адаптеров для SFC v1.
export const ENDGE_SFC_RENDER_ADAPTER_PROTOCOL = 'endge-sfc'

// Текущая версия контракта renderer-адаптеров SFC.
export const ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION = 1

// Renderer-neutral описание зарегистрированного UI adapter-а.
export interface UIRenderAdapter<TImplementation = unknown> {
  id: string
  protocol: string
  protocolVersion: number
  renderer: string
  renderers: Readonly<Record<string, TImplementation>>
  // Непрозрачные точки входа host, принадлежащие адаптеру: shell, корень SFC, корень runtime и прочие.
  roots?: Readonly<Record<string, unknown>>
}

// Требования consumer-а к renderer adapter-у.
export interface UIRenderAdapterRequirement {
  id: string
  protocol?: string
  protocolVersion?: number
  renderer?: string
  requiredRendererKeys?: readonly string[]
  requiredRootKeys?: readonly string[]
}

// Требования к уже активированному renderer adapter-у.
export type UIActiveRenderAdapterRequirement = Omit<UIRenderAdapterRequirement, 'id'>

// Сериализуемое описание adapter-а без его runtime implementations.
export interface UIRenderAdapterDescriptor {
  id: string
  protocol: string
  protocolVersion: number
  renderer: string
  rendererKeys: string[]
  rootKeys: string[]
}
