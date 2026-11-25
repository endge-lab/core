export type TimelineRecipeAlign = 'left' | 'center' | 'right'

export interface TimelineRecipeContent {
  type: 'text' | 'icon'
  align: TimelineRecipeAlign
  value: string
  field?: string
}

export type TimelineRecipeBoundary
  = | { mode: 'ratio', offset: number }
    | { mode: 'px', edge: 'start' | 'end', offset: number }
    | { mode: 'time', field: string, offset: number, offsetField?: string, subtract?: boolean }

export interface TimelineRecipeRect {
  id: string
  type: 'rect'
  fill: string
  content?: TimelineRecipeContent
}

export interface TimelineRecipeSplit {
  id: string
  type: 'split'
  axis: 'x' | 'y'
  at: TimelineRecipeBoundary
  first: TimelineRecipeNode
  second: TimelineRecipeNode
}

export type TimelineRecipeNode = TimelineRecipeRect | TimelineRecipeSplit

export interface TimelineRecipeOverlay extends TimelineRecipeRect {
  top: number
  height: number
  from?: TimelineRecipeBoundary
  to?: TimelineRecipeBoundary
}

export interface TimelineRecipeLayout {
  layout: TimelineRecipeNode
  overlays?: TimelineRecipeOverlay[]
}

export interface TimelineRecipeBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface TimelineRecipeGeometry {
  rectangles: Record<string, TimelineRecipeBounds>
  dividers: Record<string, { bounds: TimelineRecipeBounds, position: number, axis: 'x' | 'y', invalid: boolean }>
}

interface TimelineRecipeGeometryInput {
  bounds: TimelineRecipeBounds
  task: object
  timeToPx: (time: number) => number
}

export function createTimelineRecipeLayout(): TimelineRecipeLayout {
  return { layout: { id: 'body', type: 'rect', fill: '#478acf' } }
}

export function timelineRecipeField(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (
    key !== '__proto__' && key !== 'constructor' && key !== 'prototype'
    && value != null && typeof value === 'object' && Object.hasOwn(value, key)
      ? (value as Record<string, unknown>)[key]
      : undefined
  ), source)
}

export function timelineRecipeInstant(value: unknown): number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string' && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    return Date.parse(value)
  }
  return Number.NaN
}

function boundaryPosition(boundary: TimelineRecipeBoundary, start: number, size: number, input: TimelineRecipeGeometryInput): number {
  if (boundary.mode === 'px') {
    return boundary.edge === 'end' ? start + size - boundary.offset : start + boundary.offset
  }
  if (boundary.mode === 'ratio') {
    return start + size * boundary.offset
  }
  const timestamp = timelineRecipeInstant(timelineRecipeField(input.task, boundary.field))
  const delta = boundary.offsetField ? timelineRecipeField(input.task, boundary.offsetField) : 0
  return typeof delta === 'number'
    ? input.timeToPx(timestamp + boundary.offset + (boundary.subtract ? -delta : delta))
    : Number.NaN
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function measureTimelineRecipe(recipe: TimelineRecipeLayout, input: TimelineRecipeGeometryInput): TimelineRecipeGeometry {
  const rectangles: TimelineRecipeGeometry['rectangles'] = Object.create(null)
  const dividers: TimelineRecipeGeometry['dividers'] = Object.create(null)
  function visit(node: TimelineRecipeNode, bounds: TimelineRecipeBounds) {
    if (node.type === 'rect') {
      rectangles[node.id] = bounds
      return
    }
    const horizontal = node.axis === 'x'
    const start = horizontal ? bounds.x : bounds.y
    const size = horizontal ? bounds.width : bounds.height
    const point = boundaryPosition(node.at, start, size, input)
    const valid = Number.isFinite(point)
    const position = valid ? clamp(point, start, start + size) : start + size / 2
    const first = position - start
    dividers[node.id] = { bounds, position, axis: node.axis, invalid: !valid }
    visit(node.first, horizontal ? { ...bounds, width: first } : { ...bounds, height: first })
    visit(node.second, horizontal
      ? { ...bounds, x: position, width: size - first }
      : { ...bounds, y: position, height: size - first })
  }
  visit(recipe.layout, input.bounds)
  const { x, y, width, height } = input.bounds
  for (const overlay of recipe.overlays ?? []) {
    const from = overlay.from ? boundaryPosition(overlay.from, x, width, input) : x
    const to = overlay.to ? boundaryPosition(overlay.to, x, width, input) : x + width
    if (Number.isFinite(from) && Number.isFinite(to) && from < to) {
      const left = clamp(from, x, x + width)
      rectangles[overlay.id] = {
        x: left,
        y: y + Math.min(overlay.top, height),
        width: clamp(to, left, x + width) - left,
        height: clamp(overlay.height, 0, Math.max(0, height - overlay.top)),
      }
    }
  }
  return { rectangles, dividers }
}

export function timelineRecipeRects(recipe: TimelineRecipeLayout): TimelineRecipeRect[] {
  function collect(node: TimelineRecipeNode): TimelineRecipeRect[] {
    return node.type === 'rect' ? [node] : [...collect(node.first), ...collect(node.second)]
  }
  return [...collect(recipe.layout), ...(recipe.overlays ?? [])]
}

export function validateTimelineRecipeLayout(value: unknown): asserts value is TimelineRecipeLayout {
  function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Ожидается объект рецепта.')
    }
    return value as Record<string, unknown>
  }
  function number(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value)
  }
  function boundary(raw: unknown, allowTime: boolean) {
    const at = record(raw)
    if (!number(at.offset)) {
      throw new Error('Смещение границы должно быть числом.')
    }
    if (at.mode === 'px' && (at.edge === 'start' || at.edge === 'end')) {
      return
    }
    if (allowTime && at.mode === 'ratio' && at.offset >= 0 && at.offset <= 1) {
      return
    }
    if (allowTime && at.mode === 'time' && typeof at.field === 'string' && at.field.length > 0
      && (at.offsetField === undefined || typeof at.offsetField === 'string')
      && (at.subtract === undefined || typeof at.subtract === 'boolean')) {
      return
    }
    throw new Error('Некорректная привязка границы.')
  }
  const ids = new Set<string>()
  function node(value: unknown, depth: number): Record<string, unknown> {
    const item = record(value)
    if (depth > 16 || ids.size >= 256 || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
      throw new Error('У каждого блока должен быть уникальный ID. Проверьте глубину и количество блоков.')
    }
    ids.add(item.id)
    if (item.type === 'split') {
      if (item.axis !== 'x' && item.axis !== 'y') {
        throw new Error('Для деления нужна ось X или Y.')
      }
      boundary(item.at, item.axis === 'x')
      node(item.first, depth + 1)
      node(item.second, depth + 1)
      return item
    }
    if (item.type !== 'rect' || typeof item.fill !== 'string' || !item.fill.trim()) {
      throw new Error('Для прямоугольника нужен цвет заливки.')
    }
    if (item.content !== undefined) {
      const content = record(item.content)
      if ((content.type !== 'text' && content.type !== 'icon') || typeof content.value !== 'string'
        || (content.field !== undefined && typeof content.field !== 'string')
        || (content.align !== 'left' && content.align !== 'center' && content.align !== 'right')) {
        throw new Error('Проверьте содержимое прямоугольника и выравнивание.')
      }
    }
    return item
  }
  const recipe = record(value)
  node(recipe.layout, 0)
  if (recipe.overlays === undefined) {
    return
  }
  if (!Array.isArray(recipe.overlays)) {
    throw new TypeError('Слои должны быть массивом.')
  }
  for (const value of recipe.overlays) {
    const item = node(value, 0)
    if (item.type !== 'rect' || !number(item.top) || item.top < 0 || !number(item.height) || item.height <= 0) {
      throw new Error('Слою нужны положительная высота и отступ от верха.')
    }
    if (item.from !== undefined) {
      boundary(item.from, true)
    }
    if (item.to !== undefined) {
      boundary(item.to, true)
    }
  }
}
