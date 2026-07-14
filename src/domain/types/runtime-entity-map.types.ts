import type { RAction } from '@/domain/entities/reflect/RAction'
import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import type { RPage } from '@/domain/entities/reflect/RPage'
import type { RProject } from '@/domain/entities/reflect/RProject'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RView } from '@/domain/entities/reflect/RView'
import type { RComponent } from '@/domain/types/component.types'
import type { RFilter } from '@/domain/entities/reflect/RFilter'
import type { RComposition } from '@/domain/entities/reflect/RComposition'
import type { RStore } from '@/domain/entities/reflect/RStore'

/**
 * Канонический перечень сущностей, для которых может существовать runtime-host.
 */
export interface RuntimeEntityModelMap {
  /** Доменная модель проекта. */
  project: RProject
  /** Доменная модель страницы. */
  page: RPage
  /** Доменная модель view. */
  view: RView
  /** Базовая доменная модель компонента. */
  component: RComponent
  /** Доменная модель SFC-компонента нового API. */
  'component-sfc': RComponentSFC
  /** Доменная модель запроса. */
  query: RQuery
  /** Source-first Filter runtime. */
  filter: RFilter
  /** Runtime orchestration graph. */
  composition: RComposition
  /** Source-first reactive Store runtime. */
  store: RStore
  /** Доменная модель action. */
  action: RAction
  /** Доменная модель табличного компонента. */
  table: RComponentTable
}

/** Дискриминатор типа runtime-сущности. */
export type RuntimeEntityType = keyof RuntimeEntityModelMap
