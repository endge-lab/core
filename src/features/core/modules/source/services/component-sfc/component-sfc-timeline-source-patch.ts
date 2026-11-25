import type { TimelineRecipeLayout } from '@/features/core/modules/domain/component/timeline-task-recipe'
import type { ComponentSFCVisualInspectionOptions } from '@/features/core/modules/domain/types/component/sfc/visual-projection.types'
import { parseComponentSFC } from '@/features/core/modules/compiler/services/component-sfc/component-sfc-parse'
import { escapeAttribute, insertChild, setComponentSFCNodeAttributeValue } from '@/features/core/modules/source/services/component-sfc/component-sfc-table-source-patch'
import { inspectComponentSFCVisual } from '@/features/core/modules/source/services/component-sfc/component-sfc-visual-projection'

const CHART_ATTRIBUTES = new Set(['data', 'title', 'height', 'min-height', 'max-height', 'hidden', 'collapsed', 'columns', 'options', 'preset', 'settings', 'timezone'])
const GROUP_ATTRIBUTES = new Set(['sync', 'leader', 'label-width', 'splitter', 'range'])

export interface ComponentSFCTimelineSourcePatch {
  chartIndex?: number
  name: string
  value: unknown
  binding?: boolean
}

// Patches a single authored attribute; title and context timezone support binding controls.
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
  const bound = projection.attributes.find(attribute => attribute.name === patch.name)?.value
  if (bound?.kind === 'expression' && patch.name !== 'title' && !(patch.name === 'timezone' && bound.source.trim() === '$context.timezone')) {
    throw new Error('Привязка Timeline редактируется в Source.')
  }
  const node = findTimelineNode(source, projection.sourceRange.start)
  const dynamic = patch.binding || typeof patch.value !== 'string'
  const value = patch.value == null ? null : patch.binding ? String(patch.value) : dynamic ? JSON.stringify(patch.value) : String(patch.value)
  return setComponentSFCNodeAttributeValue(source, node, patch.name, value, dynamic ? 'expression' : 'literal')
}

export interface ComponentSFCTimelineColumnSource {
  attributes: Record<string, { value: string | boolean, binding?: boolean } | undefined>
}

/** Replace only columns so that recipes, chart bindings, and comments stay in Source. */
export function patchComponentSFCTimelineColumns(
  source: string,
  chartStart: number,
  columns: readonly ComponentSFCTimelineColumnSource[],
): string {
  const chart = findTimelineNode(source, chartStart)
  if (chart.tag !== 'TimelineChart') {
    throw new Error('Узел TimelineChart не найден.')
  }
  const existing = chart.children.filter(node => node.kind === 'element' && node.tag === 'Column')
  const markup = columns.map(({ attributes }) => {
    const items = Object.entries(attributes).flatMap(([name, attribute]) => {
      if (attribute == null) {
        return []
      }
      if (attribute.value === true && !attribute.binding) {
        return [name]
      }
      return [`${attribute.binding ? ':' : ''}${name}="${escapeAttribute(String(attribute.value))}"`]
    })
    return `<Column ${items.join(' ')} />`
  }).join('\n')
  let next = source
  const first = existing[0]
  for (const { range } of [...existing].reverse()) {
    const lineStart = next.lastIndexOf('\n', range.start - 1) + 1
    const before = next.slice(lineStart, range.start)
    if (range === first?.range && markup) {
      const indent = before.trim() ? '' : before
      next = next.slice(0, range.start) + markup.replaceAll('\n', `\n${indent}`) + next.slice(range.end)
      continue
    }
    const lineEnd = next.indexOf('\n', range.end)
    const ownLine = lineEnd >= 0 && !before.trim() && !next.slice(range.end, lineEnd).trim()
    next = next.slice(0, ownLine ? lineStart : range.start) + next.slice(ownLine ? lineEnd + 1 : range.end)
  }
  const nextChart = findTimelineNode(next, chartStart)
  if (!markup) {
    return setComponentSFCNodeAttributeValue(next, nextChart, 'columns', '[]', 'expression')
  }
  const withoutArray = setComponentSFCNodeAttributeValue(next, nextChart, 'columns', null, 'expression')
  return first ? withoutArray : insertChild(withoutArray, findTimelineNode(withoutArray, chartStart), markup)
}

export interface ComponentSFCTimelineRecipeSource {
  id: string
  name: string
  kind: string
  when: string
  recipe: TimelineRecipeLayout
}

export function patchComponentSFCTimelineRecipe(
  source: string,
  chartStart: number,
  recipeStart: number | undefined,
  recipe: ComponentSFCTimelineRecipeSource | null,
): string {
  const chart = findTimelineNode(source, chartStart)
  if (chart.tag !== 'TimelineChart') {
    throw new Error('Узел TimelineChart не найден.')
  }
  const previous = chart.children.find(child => child.kind === 'element'
    && child.tag === 'TimelineTaskRecipe' && child.range.start === recipeStart)
  if (recipeStart !== undefined && !previous) {
    throw new Error('Рецепт в Source не найден.')
  }
  if (!recipe) {
    if (!previous) {
      return source
    }
    const lineStart = source.lastIndexOf('\n', previous.range.start - 1) + 1
    const lineEnd = source.indexOf('\n', previous.range.end)
    if (lineEnd >= 0 && !source.slice(lineStart, previous.range.start).trim()
      && !source.slice(previous.range.end, lineEnd).trim()) {
      return source.slice(0, lineStart) + source.slice(lineEnd + 1)
    }
    return source.slice(0, previous.range.start) + source.slice(previous.range.end)
  }
  const attrs = [
    ['id', recipe.id],
    ['name', recipe.name],
    ['kind', recipe.kind],
    [':when', recipe.when],
  ].filter(([, value]) => Boolean(value)).map(([name, value]) => `${name}="${escapeAttribute(value)}"`)
  const json = JSON.stringify(recipe.recipe).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/</g, '&lt;')
  const markup = `<TimelineTaskRecipe ${attrs.join(' ')} :recipe='${json}' />`
  return previous
    ? source.slice(0, previous.range.start) + markup + source.slice(previous.range.end)
    : insertChild(source, chart, markup)
}

function findTimelineNode(source: string, start: number) {
  const roots = parseComponentSFC(source).ast?.template?.roots ?? []
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
  return node
}
