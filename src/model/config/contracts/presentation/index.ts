import type { PresentationContract } from '@/domain/types/configuration/faceted-cascade'

import { COMPONENT_PRESENTATION_CONTRACTS } from '@/model/config/contracts/presentation/component'
import { PAGE_PRESENTATION_CONTRACTS } from '@/model/config/contracts/presentation/page'
import { PAGE_TEMPLATE_PRESENTATION_CONTRACTS } from '@/model/config/contracts/presentation/page-template'
import { PROJECT_PRESENTATION_CONTRACTS } from '@/model/config/contracts/presentation/project'
import { QUERY_PRESENTATION_CONTRACTS } from '@/model/config/contracts/presentation/query'
import { VIEW_PRESENTATION_CONTRACTS } from '@/model/config/contracts/presentation/view'

export * from '@/model/config/contracts/presentation/component'
export * from '@/model/config/contracts/presentation/page'
export * from '@/model/config/contracts/presentation/page-template'
export * from '@/model/config/contracts/presentation/project'
export * from '@/model/config/contracts/presentation/query'
export * from '@/model/config/contracts/presentation/view'

export const ENDGE_CORE_DEFAULT_PRESENTATION_CONTRACTS: PresentationContract[] = [
  ...PROJECT_PRESENTATION_CONTRACTS,
  ...PAGE_PRESENTATION_CONTRACTS,
  ...PAGE_TEMPLATE_PRESENTATION_CONTRACTS,
  ...VIEW_PRESENTATION_CONTRACTS,
  ...COMPONENT_PRESENTATION_CONTRACTS,
  ...QUERY_PRESENTATION_CONTRACTS,
]
