import type { RComponentSFC_SourceRange } from '@/domain/types/component/sfc'

/** Семантический вид узла в живом SFC render tree. */
export type SFCRenderInspectionNodeKind = 'component' | 'element' | 'text' | 'expression'

/** Вычисленное значение template binding вместе с его source provenance. */
export interface SFCRenderInspectionBinding {
  kind: 'literal' | 'expression'
  source?: string
  reads: string[]
  value: unknown
}

/** Данные, которыми renderer регистрирует один живой SFC instance. */
export interface SFCRenderInspectionNodeInput {
  runtimeId: string
  componentIdentity: string
  componentStack: string[]
  scope: string
  parentId: string | null
  nodeId: string
  kind: SFCRenderInspectionNodeKind
  tag: string
  componentTag?: string
  calledComponentIdentity?: string
  sourceRange?: RComponentSFC_SourceRange
  props: Record<string, unknown>
  componentProps: Record<string, unknown>
  locals: Record<string, unknown>
  bindings: Record<string, SFCRenderInspectionBinding>
  meta?: Record<string, unknown>
}

/** Зарегистрированный живой SFC instance. */
export interface SFCRenderInspectionNode extends SFCRenderInspectionNodeInput {
  id: string
  updatedAt: number
}

/** Иерархическая проекция зарегистрированных SFC instances. */
export interface SFCRenderInspectionTreeNode extends SFCRenderInspectionNode {
  children: SFCRenderInspectionTreeNode[]
}

/** Optional renderer-neutral sink: при null runtime не выполняет inspection work. */
export interface SFCRenderInspectionSessionLike {
  registerNode: (input: SFCRenderInspectionNodeInput) => string
  unregisterNode: (id: string) => void
  getNode: (id: string) => SFCRenderInspectionNode | null
  getTree: (runtimeId?: string) => SFCRenderInspectionTreeNode[]
  subscribe: (listener: () => void) => VoidFunction
  clearRuntime: (runtimeId: string) => void
  clear: () => void
}
