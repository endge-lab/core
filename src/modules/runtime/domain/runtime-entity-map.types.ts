import type { RAction } from '@/modules/domain/entities/RAction'
import type { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'
import type { RComposition } from '@/modules/domain/entities/RComposition'
import type { RFilter } from '@/modules/domain/entities/RFilter'
import type { RPage } from '@/modules/domain/entities/RPage'
import type { RProject } from '@/modules/domain/entities/RProject'
import type { RQuery } from '@/modules/domain/entities/RQuery'
import type { RStore } from '@/modules/domain/entities/RStore'
import type { RStream } from '@/modules/domain/entities/RStream'

/**
 * Канонический перечень сущностей, для которых может существовать runtime-host.
 */
export interface RuntimeEntityModelMap {
  /** Доменная модель проекта. */
  'project': RProject
  /** Доменная модель страницы. */
  'page': RPage
  /** Доменная модель SFC-компонента нового API. */
  'component-sfc': RComponentSFC
  /** Доменная модель запроса. */
  'query': RQuery
  /** Source-first runtime для Filter. */
  'filter': RFilter
  /** Граф оркестрации runtime. */
  'composition': RComposition
  /** Source-first реактивный runtime Store. */
  'store': RStore
  /** Внешний или эмулируемый нормализованный поток событий. */
  'stream': RStream
  /** Доменная модель action. */
  'action': RAction
}

/** Дискриминатор типа runtime-сущности. */
export type RuntimeEntityType = keyof RuntimeEntityModelMap
