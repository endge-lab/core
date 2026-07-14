import type { EndgeContract } from '@/domain/types/configuration/faceted-cascade'
import type { ConfigurationContract } from '@/domain/types/configuration/configuration-contract.types'

import { ENDGE_CORE_DEFAULT_BEHAVIOR_CONTRACTS } from '@/model/config/contracts/behavior'
import { ENDGE_CORE_DEFAULT_CONFIGURATION_CONTRACTS as ENDGE_CORE_CONFIGURATION_CONTRACTS } from '@/model/config/contracts/configuration'
import { ENDGE_CORE_DEFAULT_PRESENTATION_CONTRACTS } from '@/model/config/contracts/presentation'

export * from '@/model/config/contracts/behavior'
export * from '@/model/config/contracts/configuration'
export * from '@/model/config/contracts/presentation'

/**
 * Единый стартовый каталог контрактов faceted cascade для core-сущностей Endge.
 */
export const ENDGE_CORE_DEFAULT_CONTRACTS: EndgeContract[] = [
  ...ENDGE_CORE_DEFAULT_BEHAVIOR_CONTRACTS,
  ...ENDGE_CORE_DEFAULT_PRESENTATION_CONTRACTS,
  ...ENDGE_CORE_CONFIGURATION_CONTRACTS,
]

/**
 * Совместимый alias для выборки configuration contracts отдельно от общего каталога.
 */
export const ENDGE_CORE_DEFAULT_CONFIGURATION_CONTRACTS: ConfigurationContract[] = [
  ...ENDGE_CORE_CONFIGURATION_CONTRACTS,
]

/**
 * Совместимый alias для существующего behavior/event-слоя.
 */
export const ENDGE_CORE_DEFAULT_EVENT_CONTRACTS = ENDGE_CORE_DEFAULT_BEHAVIOR_CONTRACTS
