import { Expose } from 'class-transformer'

import { REntity, type DuplicateOptions } from '@/domain/entities/reflect/REntity'
import type {
  RComponentRenderTarget,
  RComponentSourceKind,
} from '@/domain/types/component/component-core.types'

/**
 * Чистая базовая модель компонента нового поколения.
 *
 * В этом классе хранятся только persisted-поля документа. Runtime-состояние,
 * диагностика, AST и IR живут в ComponentSFCRuntimeHost.
 */
export abstract class RComponentCore extends REntity {
  /** Внутренний маркер новой ветки компонентов. */
  @Expose()
  kind: string = 'component-core'

  /** Формат source, из которого построен компонент. */
  @Expose()
  sourceKind: RComponentSourceKind = 'component-sfc'

  /** Версия схемы новой модели компонента. */
  @Expose()
  modelVersion: number = 1

  /** Список целей рендера, которые компонент потенциально поддерживает. */
  @Expose()
  supportedTargets: RComponentRenderTarget[] = []

  /** Возвращает canonical source компонента. */
  abstract getSource(): string

  /** Проверяет, заявлена ли поддержка конкретной цели рендера. */
  supportsTarget(target: RComponentRenderTarget): boolean {
    return this.supportedTargets.includes(target)
  }

  /** Создает базовую копию полей, общих для всех новых компонентов. */
  protected copyCoreFieldsTo(target: RComponentCore): void {
    target.id = this.id
    target.identity = this.identity
    target.displayName = this.displayName
    target.name = this.name
    target.description = this.description
    target.folderId = this.folderId ?? null
    target.isSystem = this.isSystem
    target.meta = { ...this.meta }
    target.kind = this.kind
    target.sourceKind = this.sourceKind
    target.modelVersion = this.modelVersion
    target.supportedTargets = [...this.supportedTargets]
  }

  /** Базовый класс не знает, как копировать конкретный source наследника. */
  override duplicate(_options: DuplicateOptions): RComponentCore {
    throw new Error(`duplicate() not implemented for ${this.constructor.name}`)
  }
}
