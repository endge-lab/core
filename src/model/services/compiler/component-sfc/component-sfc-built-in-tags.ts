import type { RComponentSFC_IR_Tag } from '@/domain/types/component/sfc'

export const ENDGE_SFC_BUILT_IN_TAGS = new Set<RComponentSFC_IR_Tag>([
  'Text', 'DateTime', 'Number', 'Icon', 'Badge', 'Dot', 'Box', 'Flex', 'Grid', 'Divider',
  'Input', 'Textarea', 'Checkbox', 'Select', 'Component', 'Table', 'Column', 'Cell',
  'ColumnMenu', 'MenuItem', 'MenuSeparator',
])

/** Проверяет, является ли tag встроенным renderer-neutral SFC primitive. */
export function isComponentSFCBuiltInTag(tag: string): tag is RComponentSFC_IR_Tag {
  return ENDGE_SFC_BUILT_IN_TAGS.has(tag as RComponentSFC_IR_Tag)
}
