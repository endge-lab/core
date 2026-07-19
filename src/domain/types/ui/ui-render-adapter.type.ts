import type { RComponentSFC_IR_Tag } from '@/domain/types/component/sfc'

/** Протокол renderer-адаптеров для SFC v1. */
export const ENDGE_SFC_RENDER_ADAPTER_PROTOCOL = 'endge-sfc'

/** Текущая версия контракта renderer-адаптеров SFC. */
export const ENDGE_SFC_RENDER_ADAPTER_PROTOCOL_VERSION = 1

/** SFC primitives, внешний вид которых полностью определяет renderer-адаптер. */
export const ENDGE_SFC_RENDER_ADAPTER_REQUIRED_KEYS = [
  'Text',
  'DateTime',
  'Number',
  'Icon',
  'Badge',
  'Dot',
  'Box',
  'Flex',
  'Grid',
  'Divider',
  'Input',
  'Textarea',
  'Checkbox',
  'Select',
] as const satisfies readonly RComponentSFC_IR_Tag[]

export type EndgeSFCRenderAdapterKey = typeof ENDGE_SFC_RENDER_ADAPTER_REQUIRED_KEYS[number]

/** Renderer-neutral описание зарегистрированного UI adapter-а. */
export interface UIRenderAdapter<TImplementation = unknown> {
  id: string
  protocol: string
  protocolVersion: number
  renderer: string
  renderers: Readonly<Record<string, TImplementation>>
  /** Opaque host entry points owned by this adapter: shell, SFC root, runtime root, etc. */
  roots?: Readonly<Record<string, unknown>>
}

/** Требования consumer-а к renderer adapter-у. */
export interface UIRenderAdapterRequirement {
  id: string
  protocol?: string
  protocolVersion?: number
  renderer?: string
  requiredRendererKeys?: readonly string[]
  requiredRootKeys?: readonly string[]
}

/** Требования к уже активированному renderer adapter-у. */
export type UIActiveRenderAdapterRequirement = Omit<UIRenderAdapterRequirement, 'id'>

/** Сериализуемое описание adapter-а без его runtime implementations. */
export interface UIRenderAdapterDescriptor {
  id: string
  protocol: string
  protocolVersion: number
  renderer: string
  rendererKeys: string[]
  rootKeys: string[]
}
