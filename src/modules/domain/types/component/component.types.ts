import type { RComponentDSL } from '@/modules/domain/entities/RComponentDSL'
import type { RComponentSFC } from '@/modules/domain/entities/RComponentSFC'
import type { RComponentTable } from '@/modules/domain/entities/RComponentTable'
import type { ComponentType } from '@/modules/domain/types/document/document.types'

/** Persisted renderer kind of a legacy component document. */
export enum ComponentKind {
  JSX = 'jsx',
  Vue = 'vue',
}

/** Legacy-компоненты, которые уже используются в таблицах. */
export type RComponent = RComponentDSL | RComponentTable

/** Любой компонент доменной модели, включая новую чистую SFC-ветку. */
export type RAnyComponent = RComponent | RComponentSFC

/**
 * Разновидности типов компонентов, которые могут быть встроены в таблицу
 */
export type ColumnComponentType = ComponentType.Html | ComponentType.Component
