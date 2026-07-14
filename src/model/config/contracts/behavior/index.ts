import type { BehaviorContract } from '@/domain/types/configuration/faceted-cascade'

import { COMPONENT_BEHAVIOR_CONTRACTS } from '@/model/config/contracts/behavior/component'
import { PAGE_BEHAVIOR_CONTRACTS } from '@/model/config/contracts/behavior/page'
import { PAGE_TEMPLATE_BEHAVIOR_CONTRACTS } from '@/model/config/contracts/behavior/page-template'
import { PROJECT_BEHAVIOR_CONTRACTS } from '@/model/config/contracts/behavior/project'
import { QUERY_BEHAVIOR_CONTRACTS } from '@/model/config/contracts/behavior/query'
import { VIEW_BEHAVIOR_CONTRACTS } from '@/model/config/contracts/behavior/view'

export * from '@/model/config/contracts/behavior/component'
export * from '@/model/config/contracts/behavior/page'
export * from '@/model/config/contracts/behavior/page-template'
export * from '@/model/config/contracts/behavior/project'
export * from '@/model/config/contracts/behavior/query'
export * from '@/model/config/contracts/behavior/view'

export const ENDGE_CORE_DEFAULT_BEHAVIOR_CONTRACTS: BehaviorContract[] = [
  ...PROJECT_BEHAVIOR_CONTRACTS,
  ...PAGE_BEHAVIOR_CONTRACTS,
  ...PAGE_TEMPLATE_BEHAVIOR_CONTRACTS,
  ...VIEW_BEHAVIOR_CONTRACTS,
  ...COMPONENT_BEHAVIOR_CONTRACTS,
  ...QUERY_BEHAVIOR_CONTRACTS,
]
