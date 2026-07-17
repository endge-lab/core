import type { CompositionActivationDescriptor } from '@/domain/types/source/composition-source.types'

const STARTUP: CompositionActivationDescriptor = Object.freeze({ mode: 'startup' })

/** Compiler-only precedence. Runtime consumes the resulting effectiveActivation. */
export function resolveCompositionActivation(
  invocationOverride: CompositionActivationDescriptor | null | undefined,
  targetRoot: CompositionActivationDescriptor | null | undefined,
  ownerScope: CompositionActivationDescriptor | null | undefined,
): CompositionActivationDescriptor {
  return invocationOverride ?? targetRoot ?? ownerScope ?? STARTUP
}
