import type { RAction } from '@/domain/entities/reflect/RAction'
import type { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import type { RPage } from '@/domain/entities/reflect/RPage'
import type { RProject } from '@/domain/entities/reflect/RProject'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { RView } from '@/domain/entities/reflect/RView'
import type { RComponent } from '@/domain/types/component.types'

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
  /** Доменная модель запроса. */
  query: RQuery
  /** Доменная модель action. */
  action: RAction
  /** Доменная модель табличного компонента. */
  table: RComponentTable
}

/** Дискриминатор типа runtime-сущности. */
export type RuntimeEntityType = keyof RuntimeEntityModelMap
