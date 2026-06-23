import type { RComponentDSL } from '@/domain/entities/reflect/RComponentDSL'
import type { RComponentTable } from '@/domain/entities/reflect/RComponentTable'
import type { ComponentType } from '@/domain/types/document.types'

export type RComponent = RComponentDSL | RComponentTable

/**
 * Разновидности типов компонентов, которые могут быть встроены в таблицу
 */
export type ColumnComponentType = Exclude<ComponentType, ComponentType.Table>
