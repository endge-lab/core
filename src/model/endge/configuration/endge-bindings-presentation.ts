import type { RPresentationBinding } from '@/domain/entities/reflect/RPresentationBinding'
import type {
  PresentationBindingResolverOptions,
  PresentationResolveResult,
  ResolvedPresentationBinding,
} from '@/domain/types/configuration/faceted-cascade'

import { Endge } from '@/model/endge/kernel/endge'
import { EndgeResolveEngine } from '@/model/helpers/endge-resolve-engine'

/**
 * Модуль резолва presentation bindings.
 * Находит итоговые renderer-привязки для роли с учётом наследования,
 * окружения и режимов объединения override-правил.
 */
export class EndgeBindingsPresentation {
  private readonly _engine = new EndgeResolveEngine<RPresentationBinding, ResolvedPresentationBinding>({
    getSource: () => Endge.domain.getPresentationBindings(),
    getSelector: raw => raw.role,
    buildResolved: (raw, ctx) => ({
      id: ctx.id,
      identity: ctx.identity,
      displayName: ctx.displayName,
      ownerType: ctx.requestedOwnerType,
      ownerId: ctx.requestedOwnerId,
      targetType: ctx.requestedTargetType,
      targetId: ctx.requestedTargetId,
      role: String(raw.role ?? '').trim(),
      selector: ctx.selector,
      rendererRef: String(raw.rendererRef ?? '').trim(),
      when: raw.when == null ? null : String(raw.when).trim(),
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
    isResolvedValid: item => Boolean(item.role && item.rendererRef),
  })

  /**
   * Публичная короткая точка входа для резолва presentation bindings.
   * Возвращает объект с найденными биндингами и метаданными запроса.
   */
  public resolve(opts: PresentationBindingResolverOptions): PresentationResolveResult {
    return this.resolveForRole(opts)
  }

  /**
   * Возвращает итоговый набор renderer-ов для указанной роли в виде объекта:
   * bindings, request, role, found, count.
   */
  public resolveForRole(opts: PresentationBindingResolverOptions): PresentationResolveResult {
    const role = String(opts.role ?? '').trim()
    const bindings = this._engine.resolve({
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      selector: opts.role,
      environmentId: opts.environmentId,
    })
    return {
      request: opts,
      role,
      bindings,
      found: bindings.length > 0,
      count: bindings.length,
      facet: 'presentation',
    }
  }

  /**
   * Возвращает только унаследованные presentation bindings,
   * не включая правила, описанные прямо на текущем owner.
   */
  public getInheritedBindings(opts: PresentationBindingResolverOptions): ResolvedPresentationBinding[] {
    return this._engine.resolve({
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      selector: opts.role,
      environmentId: opts.environmentId,
    }, 'inherited-only')
  }

  /**
   * Возвращает только локальные presentation bindings текущего owner
   * без просмотра родительской цепочки.
   */
  public getOwnBindings(opts: PresentationBindingResolverOptions): ResolvedPresentationBinding[] {
    return this._engine.resolve({
      ownerType: opts.ownerType,
      ownerId: opts.ownerId,
      targetType: opts.targetType,
      targetId: opts.targetId,
      selector: opts.role,
      environmentId: opts.environmentId,
    }, 'direct-only')
  }
}
