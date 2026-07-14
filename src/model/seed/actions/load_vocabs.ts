import type { ActionRuntimeHostContext } from '@/domain/types/runtime/runtime-host.types'

import { Endge } from '@/model/endge/kernel/endge'

/** Берёт вход из context.input (массив id справочников), при необходимости — из context.input.input. */
export function loadVocabs(context: ActionRuntimeHostContext): Promise<void> {
  const raw = context.input
  const ids = Array.isArray(raw)
    ? raw
    : (raw != null && typeof raw === 'object' && 'input' in raw && Array.isArray((raw as { input?: unknown }).input)
        ? (raw as { input: number[] | string[] }).input
        : [])
  const normalized = ids.map(x => Number(x)).filter(n => Number.isFinite(n))
  if (!normalized.length) {
    return Promise.resolve()
  }
  return Promise.all(normalized.map(vocabId => Endge.vocabs.loadById(vocabId))).then(() => undefined)
}
