import type { ComponentType } from '@/features/core/modules/domain/types/document/document.types'
import { TypeRecord } from '@endge/utils'
import { Expose } from 'class-transformer'
import { REntity } from '@/features/core/modules/domain/entities/REntity'
import { RField } from '@/features/core/modules/domain/entities/RField'
import { ComponentKind } from '@/features/core/modules/domain/types/component/component.types'

/**
 * Архивная persisted-модель legacy-компонента.
 *
 * Класс хранит только поля документа. Legacy compile/runtime/render pipeline
 * удалён; исполнение поддерживается только для source-first компонентов.
 */
export class RComponentBase extends REntity {
  // DSL компонент будет переопределять его
  @Expose()
  kind: ComponentKind = ComponentKind.Vue

  @Expose()
  type!: ComponentType

  // Типы входных данных, из которых будет производиться извлечение
  @Expose({ name: 'inputs' })
  @TypeRecord(RField)
  inputFields: Record<string, RField> = {}

  /** Сохранённый legacy source настройки. Он хранится только для просмотра. */
  @Expose()
  setupScript: string = ''

  @Expose()
  runtimeFilters: string[] = []
}
