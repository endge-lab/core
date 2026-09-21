import type { RComponentSFC_IR_DataMetaReference } from '@/features/core/modules/domain/types/component/sfc/ir.types'

/** Адрес Meta-чтения стабилен между client renderer и его наблюдаемым представлением. */
export function runtimeInspectionMetaKey(reference: RComponentSFC_IR_DataMetaReference & { boundaryId?: string, rowKey?: unknown }, namespace?: string): string {
  return JSON.stringify([reference.kind, 'prop' in reference ? reference.prop : null, reference.path, reference.boundaryId ?? null, reference.rowKey ?? null, namespace ?? null])
}
