import type { ActionStepHandler } from '@/domain/types/action.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RAction } from '@/domain/entities/reflect/RAction'
import { RQuery } from '@/domain/entities/reflect/RQuery'
import { Endge } from '@/model/endge/endge'

/**
 * Привязка кастомного кода к существующим сущностям ядра.
 * Не связана с declarative bindings и event contracts.
 */
export class EndgeBind extends EndgeModule {
  /**
   * Находит конвертер по identity и ставит кастомный обработчик (setCustom).
   * @param identity - id конвертера в домене
   * @param handler - функция (value) => convertedValue
   * @returns true, если конвертер найден и обработчик установлен
   */
  converter(identity: string, handler: (v: any) => any): boolean {
    const c = Endge.domain.getConverter(identity)
    if (!c) { return false }
    c.setCustom(handler)
    return true
  }

  /**
   * Привязывает обработчик runtime-step в контексте конкретного action.
   * @param actionOrId - действие или его id/identity
   * @param runtimeId - id runtime-step внутри переданного action
   * @param handler - обработчик шага
   * @returns true, если action и runtime-step найдены, и обработчик установлен
   */
  action(actionOrId: RAction | string | number, runtimeId: string, handler: ActionStepHandler): boolean {
    const action = actionOrId instanceof RAction ? actionOrId : Endge.domain.getAction(actionOrId)
    if (!action) { return false }
    const id = String(runtimeId).trim()
    if (!id) { return false }

    action.compile()
    const keys: string[] = []
    const nodes = Array.isArray(action.definition?.nodes) ? action.definition.nodes : []
    for (const node of nodes) {
      const kind = String(node?.kind ?? '').trim()
      const blockId = String(node?.blockId ?? '').trim()
      const meta = node?.meta && typeof node.meta === 'object' && !Array.isArray(node.meta)
        ? node.meta as Record<string, unknown>
        : {}
      const stepKind = String(meta.stepKind ?? '').trim()
      const isRuntimeNode = kind === 'runtimeAction' || stepKind === 'runtime' || blockId === 'core.runtime-action'
      if (!isRuntimeNode) { continue }
      const rawKey = String(meta.runtimeId ?? meta.actionId ?? '').trim()
      if (rawKey === id) { keys.push(rawKey); continue }
      if (meta.actionId != null) {
        const refAction = Endge.domain.getAction(meta.actionId)
        if (refAction?.identity === id) { keys.push(rawKey) }
      }
    }
    if (keys.length === 0) { return false }
    for (const key of keys) { action.setStepHandler(key, handler) }
    return true
  }

  /**
   * Подвязывает кастомный executor и/или generator к запросу из домена.
   * @param identityOrId - RQuery или id/identity запроса
   * @param executor - функция выполнения запроса
   * @returns true, если запрос найден и override применён
   */
  query(
    identityOrId: RQuery | string | number,
    executor: () => Promise<any>,
  ): boolean {
    const q = identityOrId instanceof RQuery ? identityOrId : Endge.domain.getQuery(identityOrId)
    q.override({
      executor,
    })
    return true
  }
}
