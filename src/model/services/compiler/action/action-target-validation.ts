import type {
  ActionExecutionTarget,
  ActionTargetSelector,
} from '@/domain/types/runtime/action.types'

export type ActionTargetErrorCode
  = 'action-target-required'
    | 'action-target-type-mismatch'
    | 'action-target-identity-mismatch'

export class ActionTargetError extends Error {
  public constructor(
    public readonly code: ActionTargetErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ActionTargetError'
  }
}

/** Normalizes and validates an authoring target contract. */
export function normalizeActionTargets(value: unknown): ActionTargetSelector[] | null {
  if (value == null)
    return null
  if (!Array.isArray(value) || value.length === 0)
    throw new ActionTargetError('action-target-type-mismatch', 'Action target must be a non-empty array or null.')

  const seen = new Set<string>()
  return value.map((raw, index) => {
    const selector = raw != null && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {}
    const type = String(selector.type ?? '').trim()
    const identity = String(selector.identity ?? '').trim() || undefined
    if (!type)
      throw new ActionTargetError('action-target-type-mismatch', `Action target type is required at index ${index}.`)
    const key = `${type}\u0000${identity ?? ''}`
    if (seen.has(key))
      throw new ActionTargetError('action-target-type-mismatch', `Duplicate Action target selector: ${type}${identity ? `:${identity}` : ''}.`)
    seen.add(key)
    return identity ? { type, identity } : { type }
  })
}

/** Validates one concrete runtime target against alternative selectors. */
export function validateActionTarget(
  selectors: readonly ActionTargetSelector[] | null,
  target: ActionExecutionTarget | undefined,
): void {
  if (selectors == null)
    return
  if (!target)
    throw new ActionTargetError('action-target-required', 'Action requires a runtime target.')

  const sameType = selectors.filter(selector => selector.type === target.type)
  if (sameType.length === 0) {
    throw new ActionTargetError(
      'action-target-type-mismatch',
      `Action target type "${target.type}" does not match: ${selectors.map(selector => selector.type).join(', ')}.`,
    )
  }
  if (!sameType.some(selector => selector.identity == null || selector.identity === target.identity)) {
    throw new ActionTargetError(
      'action-target-identity-mismatch',
      `Action target identity "${target.identity}" is not allowed.`,
    )
  }
}
