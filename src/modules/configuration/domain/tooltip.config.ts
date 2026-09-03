import type { EndgeTooltipConfiguration } from '@/modules/configuration/domain/types/configuration.type'

/** System defaults used before Workspace -> Tenant -> Project -> Environment overrides. */
export const DEFAULT_ENDGE_TOOLTIP_CONFIGURATION: Readonly<EndgeTooltipConfiguration> = Object.freeze({
  side: 'right',
  align: 'start',
  openDelay: 250,
  closeDelay: 100,
})
