import type { ComponentSFCVisualInspectionOptions } from '@/features/core/modules/domain/types/component/sfc/visual-projection.types'
import { parseComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-parse'
import { setComponentSFCNodeAttributeValue } from '@/features/core/modules/source/services/component-sfc/component-sfc-table-source-patch'
import { inspectComponentSFCVisual } from '@/features/core/modules/source/services/component-sfc/component-sfc-visual-projection'

const CHART_ATTRIBUTES = new Set(['data', 'title', 'height', 'min-height', 'max-height', 'hidden', 'collapsed', 'columns', 'options', 'preset', 'settings'])
const GROUP_ATTRIBUTES = new Set(['sync', 'leader', 'label-width', 'splitter', 'range'])

export interface ComponentSFCTimelineSourcePatch {
  chartIndex?: number
  name: string
  value: unknown
  binding?: boolean
}

// Patches a single authored attribute. Bound attributes remain owned by Source.
export function patchComponentSFCTimelineSource(
  source: string,
  patch: ComponentSFCTimelineSourcePatch,
  options?: ComponentSFCVisualInspectionOptions,
): string {
  const { timeline } = inspectComponentSFCVisual(source, options)
  const projection = patch.chartIndex == null ? timeline : timeline?.charts[patch.chartIndex]
  if (!projection) {
    throw new Error('Узел Timeline для редактирования не найден.')
  }
  const allowed = projection.tag === 'TimelineChart' ? CHART_ATTRIBUTES : GROUP_ATTRIBUTES
  if (!allowed.has(patch.name)) {
    throw new Error(`Атрибут ${patch.name} редактируется в Source.`)
  }
  if (projection.attributes.some(attribute => attribute.name === patch.name && attribute.value.kind === 'expression')) {
    throw new Error('Привязка Timeline редактируется в Source.')
  }
  const roots = parseComponentSFC(source).ast?.template?.roots ?? []
  const start = projection.sourceRange.start
  const root = roots.find(node => node.kind === 'element' && (
    node.range.start === start || node.children.some(child => child.range.start === start)
  ))
  if (root?.kind !== 'element') {
    throw new Error('Корневой узел Timeline не найден.')
  }
  const node = root.range.start === start ? root : root.children.find(child => child.range.start === start)
  if (node?.kind !== 'element') {
    throw new Error('Дочерний узел Timeline не найден.')
  }
  const dynamic = patch.binding || typeof patch.value !== 'string'
  const value = patch.value == null ? null : patch.binding ? String(patch.value) : dynamic ? JSON.stringify(patch.value) : String(patch.value)
  return setComponentSFCNodeAttributeValue(source, node, patch.name, value, dynamic ? 'expression' : 'literal')
}
