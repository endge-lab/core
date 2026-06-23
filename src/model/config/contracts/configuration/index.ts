import type { ConfigurationContract } from '@/domain/types/configuration-contract.types'

import { NAVIGATION_CONFIGURATION_CONTRACTS } from '@/model/config/contracts/configuration/navigation'

export * from '@/model/config/contracts/configuration/navigation'

export const ENDGE_CORE_DEFAULT_CONFIGURATION_CONTRACTS: ConfigurationContract[] = [
  ...NAVIGATION_CONFIGURATION_CONTRACTS,
]
