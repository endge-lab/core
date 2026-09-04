import type { CompositionActivationDescriptor } from '@/modules/source/domain/types/composition-source.types'

const STARTUP: CompositionActivationDescriptor = Object.freeze({ mode: 'startup' })

/** Приоритет только для компилятора. Runtime использует полученный effectiveActivation. */
export function resolveCompositionActivation(
  invocationOverride: CompositionActivationDescriptor | null | undefined,
  targetRoot: CompositionActivationDescriptor | null | undefined,
  ownerScope: CompositionActivationDescriptor | null | undefined,
): CompositionActivationDescriptor {
  return invocationOverride ?? targetRoot ?? ownerScope ?? STARTUP
}
