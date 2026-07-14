import type { RBehaviorBinding } from '@/domain/entities/reflect/RBehaviorBinding'
import type { FlowHandlerContext } from '@/domain/types/flow/action.types'
import type {
  BehaviorBindingResolverOptions,
  BehaviorResolveResult,
  ResolvedBehaviorBinding,
} from '@/domain/types/configuration/faceted-cascade'

import { Endge } from '@/model/endge/kernel/endge'
import { EndgeResolveEngine } from '@/model/helpers/endge-resolve-engine'

/**
 * Модуль резолва и запуска behavior bindings.
 * Преобразует сырые записи биндингов в итоговый список обработчиков для события
 * и при необходимости запускает связанные action-flow.
 */
export class EndgeBindingsBehavior {
  private readonly _engine = new EndgeResolveEngine<RBehaviorBinding, ResolvedBehaviorBinding>({
    getSource: () => Endge.domain.getBehaviorBindings(),
    getSelector: raw => raw.eventName,
    buildResolved: (raw, ctx) => ({
      id: ctx.id,
      identity: ctx.identity,
      displayName: ctx.displayName,
      ownerType: ctx.requestedOwnerType,
      ownerId: ctx.requestedOwnerId,
      targetType: ctx.requestedTargetType,
      targetId: ctx.requestedTargetId,
      eventName: String(raw.eventName ?? '').trim(),
      selector: ctx.selector,
      scriptRef: String(raw.scriptRef ?? '').trim(),
      mode: ctx.mode,
      priority: ctx.priority,
      isEnabled: ctx.isEnabled,
      environmentId: ctx.environmentId,
      isInherited: ctx.source === 'inherited',
      originBindingId: ctx.originBindingId,
      sourceOwnerType: ctx.sourceOwnerType,
      sourceOwnerId: ctx.sourceOwnerId,
      source: ctx.source,
      depth: ctx.depth,
    }),
    isResolvedValid: item => Boolean(item.eventName && item.scriptRef),
  })

  /**
   * Публичная точка входа для резолва биндингов поведения.
   * Возвращает объект с найденными биндингами и метаданными запроса.
   */
  public resolve(opts: BehaviorBindingResolverOptions): BehaviorResolveResult {
    return this.resolveForEvent(opts)
  }

  /**
   * Находит все биндинги для конкретного события с учётом каскада
   * и возвращает объект: bindings, request, eventName, found, count.
   */
  public resolveForEvent(opts: BehaviorBindingResolverOptions): BehaviorResolveResult {
    const eventName = String(opts.eventName ?? '').trim()
    const bindings = this._engine.resolve({
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      selector: opts.eventName,
      environmentId: opts.environmentId,
    })
    const result = {
      request: opts,
      eventName,
      bindings,
      found: bindings.length > 0,
      count: bindings.length,
      facet: 'behavior' as const,
    }
    if (typeof console !== 'undefined') {
      const msg = `[EndgeBehaviorBindings] resolveForEvent: событие "${eventName}", owner=${opts.ownerType}:${opts.ownerId}, найдено контрактов=${result.count}`
      if (result.found) {
        console.log(msg, bindings.map(b => ({ identity: b.identity, eventName: b.eventName, scriptRef: b.scriptRef, source: b.source })))
      }
      else {
        console.log(msg)
      }
    }
    return result
  }

  /**
   * Возвращает только унаследованные биндинги, исключая правила,
   * которые объявлены непосредственно на текущем owner.
   */
  public getInheritedBindings(opts: BehaviorBindingResolverOptions): ResolvedBehaviorBinding[] {
    return this._engine.resolve({
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      selector: opts.eventName,
      environmentId: opts.environmentId,
    }, 'inherited-only')
  }

  /**
   * Возвращает только собственные биндинги текущего owner без подъёма
   * по цепочке наследования.
   */
  public getOwnBindings(opts: BehaviorBindingResolverOptions): ResolvedBehaviorBinding[] {
    return this._engine.resolve({
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      selector: opts.eventName,
      environmentId: opts.environmentId,
    }, 'direct-only')
  }

  /**
   * Разрешает биндинги для события owner и сразу запускает привязанные action-flow.
   * Возвращает объект результата резолва (request, eventName, bindings, found, count).
   */
  public runOwnerEvent(opts: BehaviorBindingResolverOptions & {
    payload?: Record<string, unknown>
    runtime?: FlowHandlerContext
  }): BehaviorResolveResult {
    const result = this.resolveForEvent(opts)
    const eventName = String(opts.eventName ?? '').trim()
    if (typeof console !== 'undefined') {
      console.log(
        '[EndgeBehaviorBindings] runOwnerEvent:',
        `событие "${eventName}"`,
        `owner=${opts.ownerType}:${opts.ownerId}`,
        `контрактов=${result.count}`,
        result.bindings.length ? result.bindings.map(b => b.identity ?? b.scriptRef) : '—',
      )
    }
    for (const binding of result.bindings) {
      const actionId = String(binding.scriptRef ?? '').trim()
      if (!actionId) { continue }

      const action = Endge.domain.getAction(actionId)
      if (!action) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[EndgeBehaviorBindings] action не найден:', actionId, 'для биндинга', binding.identity)
        }
        continue
      }

      const runtime = Endge.runtime.execute(action, {})
      if (!runtime || runtime.kind !== 'action') { continue }

      runtime.replaceContext({
        ...runtime.context,
        input: { ...(opts.payload ?? {}) },
      })

      if (typeof console !== 'undefined') {
        console.log('[EndgeBehaviorBindings] запуск контракта', binding.identity ?? actionId, '→ action', actionId, `(событие "${eventName}")`)
      }
      Endge.runtime.flow.run(runtime)
    }
    return result
  }
}
