import type { ColumnSortConfig } from '@/domain/types/table.types'

export function normalizeSortType(v: unknown): string {
  const s: string = String(v ?? '').trim()
  return s.length ? s : 'String'
}

export function normalizeSortBy(v: unknown): string {
  return String(v ?? '').trim()
}

export function normalizeSortConfig(raw: unknown): ColumnSortConfig | null {
  if (!raw || typeof raw !== 'object')
    return null

  const by: string = normalizeSortBy((raw as any).by)
  if (!by)
    return null

  return {
    by,
    type: normalizeSortType((raw as any).type),
  }
}
