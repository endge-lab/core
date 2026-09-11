import type { EndgeTooltipConfiguration } from '@/features/core/modules/configuration/domain/types/configuration.type'

/** Системные defaults, применяемые до Workspace и выбранных фасетных документов. */
export const DEFAULT_ENDGE_TOOLTIP_CONFIGURATION: Readonly<EndgeTooltipConfiguration> = Object.freeze({
  side: 'right',
  align: 'start',
  openDelay: 250,
  closeDelay: 100,
})
