import type { RComponentSFC_IR_Tag } from './ir.types'

// SFC primitives, внешний вид которых полностью определяет renderer-адаптер.
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

export const ENDGE_SFC_RENDERER_TAGS = [
  ...ENDGE_SFC_RENDER_ADAPTER_REQUIRED_KEYS,
  'Tooltip',
  'Table',
  'TimelineChart',
  'TimelineGroup',
] as const satisfies readonly RComponentSFC_IR_Tag[]

export type EndgeSFCRendererTag = typeof ENDGE_SFC_RENDERER_TAGS[number]

export function isEndgeSFCRendererTag(value: unknown): value is EndgeSFCRendererTag {
  return typeof value === 'string' && (ENDGE_SFC_RENDERER_TAGS as readonly string[]).includes(value)
}
