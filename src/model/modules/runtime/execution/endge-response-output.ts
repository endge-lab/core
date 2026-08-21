import type { ProgramArtifact } from '@/domain/types/program/program.types'
import type { DataViewRef } from '@/domain/types/source/data-view-source.types'
import type { ResponseOutputTransform } from '@/domain/types/source/response-output.types'

import { Endge } from '@/model/kernel/endge'

/** Applies ordered Query/Vocab transforms without implicit array mapping. */
export function runResponseOutputTransforms(
  transforms: readonly ResponseOutputTransform[] | undefined,
  legacyDataViews: readonly DataViewRef[],
  value: unknown,
  children: readonly ProgramArtifact[] = [],
): unknown {
  const effective = transforms
    ?? legacyDataViews.map(ref => ({ kind: 'data-view' as const, ref }))
  return effective.reduce<unknown>((current, transform) => {
    if (transform.kind === 'data-view')
      return Endge.runtime.dataView.runRef(transform.ref, current, undefined, { children: [...children] })
    return Endge.runtime.dataView.convert(transform.identity, current, transform.options)
  }, value)
}
