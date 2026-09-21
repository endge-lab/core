import type { RComponentDSL } from '@/features/core/modules/domain/entities/RComponentDSL'
import type { RComponentSFC } from '@/features/core/modules/domain/entities/RComponentSFC'
import type { RComponentTable } from '@/features/core/modules/domain/entities/RComponentTable'
import type { ComponentType } from '@/features/core/modules/domain/types/document/document.types'

/** Сохранённый вид renderer legacy-документа компонента. */
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
