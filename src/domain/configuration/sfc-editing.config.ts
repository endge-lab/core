import type { EndgeSFCEditingConfiguration } from '@/domain/types/configuration/configuration.type'

/** Системные triggers завершения edit session до Workspace cascade. */
export const DEFAULT_ENDGE_SFC_EDITING_CONFIGURATION: Readonly<EndgeSFCEditingConfiguration> = {
  cancelOn: [
    { event: 'keydown', key: ['Escape'], prevent: true, stop: true },
    { event: 'focusout' },
  ],
  commitOn: [
    { event: 'keydown', key: ['Enter'], prevent: true },
  ],
}
