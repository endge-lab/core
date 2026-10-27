import type { CompositionActivationDescriptor, CompositionScopeDescriptor } from '@/features/core/modules/source/domain/types/composition-source.types'

const STARTUP: CompositionActivationDescriptor = Object.freeze({ mode: 'startup' })

// Приоритет только для компилятора. Runtime использует полученный effectiveActivation.
export function resolveCompositionActivation(
  invocationOverride: CompositionActivationDescriptor | null | undefined,
  targetRoot: CompositionActivationDescriptor | null | undefined,
  ownerScope: CompositionActivationDescriptor | null | undefined,
): CompositionActivationDescriptor {
  return invocationOverride ?? targetRoot ?? ownerScope ?? STARTUP
}

/**
 * Активация содержимого scope: `effectiveActivation` scope описывает его собственный запуск
 * относительно владельца, а runtime внутри scope с `.activateWhen(...)` стартуют вместе с ним.
 */
export function resolveScopeContentActivation(
  scope: Pick<CompositionScopeDescriptor, 'effectiveActivation' | 'activateWhen'> | null | undefined,
): CompositionActivationDescriptor | undefined {
  if (!scope) {
    return undefined
  }
  return scope.activateWhen ? STARTUP : scope.effectiveActivation
}
