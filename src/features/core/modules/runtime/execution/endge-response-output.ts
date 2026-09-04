import type { ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type { DataViewRef } from '@/features/core/modules/source/domain/types/data-view-source.types'
import type { ResponseOutputTransform } from '@/features/core/modules/source/domain/types/response-output.types'

import { Endge } from '@/features/core/kernel/endge'

/** Применяет упорядоченные transforms Query и Vocab без неявного mapping массивов. */
export function runResponseOutputTransforms(
  transforms: readonly ResponseOutputTransform[] | undefined,
  legacyDataViews: readonly DataViewRef[],
  value: unknown,
  children: readonly ProgramArtifact[] = [],
): unknown {
  const effective = transforms
    ?? legacyDataViews.map(ref => ({ kind: 'data-view' as const, ref }))
  return effective.reduce<unknown>((current, transform) => {
    if (transform.kind === 'data-view') {
      return Endge.runtime.dataView.runRef(transform.ref, current, undefined, { children: [...children] })
    }
    return Endge.runtime.dataView.convert(transform.identity, current, transform.options)
  }, value)
}
