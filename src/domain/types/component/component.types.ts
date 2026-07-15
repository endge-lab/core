import type { RComponentDSL } from '@/domain/entities/reflect/RComponentDSL'
import type { RComponentSFC } from '@/domain/entities/reflect/RComponentSFC'
import type { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import type { ComponentType } from '@/domain/types/document/document.types'

/** Legacy-компоненты, которые уже используются в таблицах. */
export type RComponent = RComponentDSL | RComponentTable

/** Любой компонент доменной модели, включая новую чистую SFC-ветку. */
export type RAnyComponent = RComponent | RComponentSFC

/**
 * Разновидности типов компонентов, которые могут быть встроены в таблицу
 */
export type ColumnComponentType = ComponentType.Html | ComponentType.Component
