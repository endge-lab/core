import type { RComponentDiagnostic } from '@/domain/types/component/component-core.types'

/** Renderer-neutral начальная видимость колонок Table. */
export interface ComponentSFCTableColumnVisibilityDescriptor {
  defaultHidden: string[]
  diagnostics: RComponentDiagnostic[]
}
