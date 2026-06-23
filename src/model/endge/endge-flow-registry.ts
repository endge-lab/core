import type { FlowConditionSpec } from '@/domain/types/flow-condition.types'
import type { FlowHandlerContext } from '@/domain/types/action.types'

import { DomainSectionType } from '@/domain/types/document.types'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/endge'

/**
 * Реестр конструкций flow: условия и в будущем другие сущности.
 * Регистрируется в федерации как flowRegistry.
 */
export class EndgeFlowRegistry extends EndgeModule {
  private _conditions = new Map<string, FlowConditionSpec>()

  /** Регистрация условия. */
  registerCondition(spec: FlowConditionSpec): void {
    const id = String(spec?.id ?? '').trim()
    if (!id) return
    this._conditions.set(id, spec)
  }

  /** Список спеок условий для UI. */
  listConditions(): FlowConditionSpec[] {
    return Array.from(this._conditions.values())
  }

  /** Спека по id. */
  getCondition(id: string): FlowConditionSpec | undefined {
    return this._conditions.get(String(id).trim())
  }

  /** Выполнение условия по id с контекстом и параметрами. */
  async evaluateCondition(
    conditionId: string,
    ctx: FlowHandlerContext,
    params: Record<string, unknown>,
  ): Promise<boolean> {
    const spec = this.getCondition(String(conditionId).trim())
    if (!spec) return false
    const result = spec.evaluate(ctx, params ?? {})
    return Promise.resolve(result).then(Boolean)
  }

  override init(): void {
    this._registerDefaultConditions()
  }

  /** Регистрация условий по умолчанию (в т.ч. «существует ли словарь»). */
  private _registerDefaultConditions(): void {
    this.registerCondition({
      id: 'vocab.exists',
      title: 'Словарь существует',
      description: 'Проверяет, что словарь есть в системе и загружен (данные доступны).',
      inputParams: [
        {
          name: 'vocab',
          label: 'Словарь',
          valueType: 'entity',
          optional: false,
          acceptSectionTypes: [DomainSectionType.Vocabs],
        },
      ],
      evaluate(ctx, params): boolean {
        const vocabId = params?.vocab ?? params?.vocabId
        if (vocabId == null || vocabId === '') return false
        const vocab = Endge.domain.getVocab(vocabId)
        if (!vocab?.collectionSlug) return false
        const values = Endge.vocabs.getValues(vocab.collectionSlug)
        return Array.isArray(values) && values.length > 0
      },
    })
  }
}
