import type { ComponentType } from '@/domain/types/document/document.types'
import { TypeRecord } from '@endge/utils'
import { Expose } from 'class-transformer'
import { REntity } from '@/domain/entities/reflect/REntity'
import { RField } from '@/domain/entities/reflect/RField'
import { ComponentKind } from '@/domain/types/component/component.types'

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

  /** Persisted legacy setup source. It is kept for inspection only. */
  @Expose()
  setupScript: string = ''

  @Expose()
  runtimeFilters: string[] = []
}
